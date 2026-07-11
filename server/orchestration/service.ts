// Board-scoped service layer for orchestration. Every mutation goes through
// a single kv.atomic() that checks a versionstamp, writes the record,
// maintains secondary indexes, and appends an event — never a partial
// write. REST routes and (later) MCP tools both call these functions
// directly, so there's exactly one place coordination rules live.
//
// Scope note: this file covers M1 (core store), M2 (agents, heartbeats, the
// lease reaper), and M4 (messaging, event cursors) per the build order in
// agent-kanban-orchestration-plan-v2-1.md.

import { monotonicUlid } from "jsr:@std/ulid";
import { keys } from "./kv.ts";
import {
  type Agent,
  type AgentStatus,
  type Board,
  type BoardEvent,
  type Card,
  type CardStatus,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_LEASE_MS,
  type EventType,
  type Message,
} from "./types.ts";

// ---------- Boards ----------

export async function createBoard(
  kv: Deno.Kv,
  input: { slug: string; title: string; description?: string; leaseMs?: number; heartbeatMs?: number },
): Promise<Board | { error: string }> {
  if (!input.slug.trim()) return { error: "slug is required" };
  if (!input.title.trim()) return { error: "title is required" };

  const slugKey = keys.boardBySlug(input.slug);
  const slugCheck = await kv.get(slugKey);
  if (slugCheck.value) return { error: `slug already in use: ${input.slug}` };

  const board: Board = {
    id: monotonicUlid(),
    slug: input.slug,
    title: input.title,
    description: input.description,
    leaseMs: input.leaseMs,
    heartbeatMs: input.heartbeatMs,
    createdAt: Date.now(),
  };

  // .check(slugCheck) verifies the slug key is *still* absent at commit
  // time — this is what makes slug uniqueness race-free instead of a
  // check-then-write TOCTOU bug.
  const res = await kv.atomic()
    .check(slugCheck)
    .set(keys.board(board.id), board)
    .set(slugKey, board.id)
    .commit();
  if (!res.ok) return { error: `slug already in use: ${input.slug}` };
  return board;
}

export async function listBoards(kv: Deno.Kv): Promise<Board[]> {
  const boards: Board[] = [];
  for await (const entry of kv.list<Board>({ prefix: keys.boardsPrefix() })) {
    if (!entry.value.archivedAt) boards.push(entry.value);
  }
  return boards;
}

export async function getBoardById(kv: Deno.Kv, boardId: string): Promise<Board | null> {
  const entry = await kv.get<Board>(keys.board(boardId));
  return entry.value;
}

// Accepts either a board's ULID or its slug — REST routes take `:board` in
// either form so a human can use the readable slug while machine callers
// can use the stable ID.
export async function resolveBoard(kv: Deno.Kv, idOrSlug: string): Promise<Board | null> {
  const byId = await getBoardById(kv, idOrSlug);
  if (byId) return byId;
  const slugEntry = await kv.get<string>(keys.boardBySlug(idOrSlug));
  if (!slugEntry.value) return null;
  return getBoardById(kv, slugEntry.value);
}

export async function archiveBoard(kv: Deno.Kv, boardId: string): Promise<Board | null> {
  const entry = await kv.get<Board>(keys.board(boardId));
  if (!entry.value) return null;
  const updated: Board = { ...entry.value, archivedAt: Date.now() };
  const res = await kv.atomic().check(entry).set(keys.board(boardId), updated).commit();
  return res.ok ? updated : null;
}

// ---------- Events ----------

function makeEvent(boardId: string, type: EventType, actor: string, cardId: string | undefined, detail: string | undefined): BoardEvent {
  return { id: monotonicUlid(), boardId, type, actor, cardId, detail, createdAt: Date.now() };
}

export async function listEvents(kv: Deno.Kv, boardId: string, since?: string, limit = 500): Promise<BoardEvent[]> {
  const selector: Deno.KvListSelector = since
    ? { prefix: keys.eventsPrefix(boardId), start: keys.event(boardId, since) }
    : { prefix: keys.eventsPrefix(boardId) };
  const events: BoardEvent[] = [];
  for await (const entry of kv.list<BoardEvent>(selector)) {
    if (since && entry.value.id === since) continue; // start is inclusive; since is exclusive
    events.push(entry.value);
    if (events.length >= limit) break;
  }
  return events;
}

// ---------- Cards: reads ----------

export async function getCard(kv: Deno.Kv, boardId: string, cardId: string): Promise<Card | null> {
  const entry = await kv.get<Card>(keys.card(boardId, cardId));
  return entry.value;
}

async function listCardsByStatus(kv: Deno.Kv, boardId: string, status: CardStatus): Promise<Card[]> {
  const ids: string[] = [];
  for await (const entry of kv.list<string>({ prefix: keys.cardsByStatusPrefix(boardId, status) })) {
    ids.push(entry.value);
  }
  const entries = await Promise.all(ids.map((id) => kv.get<Card>(keys.card(boardId, id))));
  return entries.map((e) => e.value).filter((c): c is Card => c !== null);
}

async function listCardsByAgent(kv: Deno.Kv, boardId: string, agentId: string): Promise<Card[]> {
  const ids: string[] = [];
  for await (const entry of kv.list<string>({ prefix: keys.cardsByAgentPrefix(boardId, agentId) })) {
    ids.push(entry.value);
  }
  const entries = await Promise.all(ids.map((id) => kv.get<Card>(keys.card(boardId, id))));
  return entries.map((e) => e.value).filter((c): c is Card => c !== null);
}

export async function listCards(
  kv: Deno.Kv,
  boardId: string,
  filter?: { status?: CardStatus; assignee?: string },
): Promise<Card[]> {
  if (filter?.status) return listCardsByStatus(kv, boardId, filter.status);
  if (filter?.assignee) return listCardsByAgent(kv, boardId, filter.assignee);
  const cards: Card[] = [];
  for await (const entry of kv.list<Card>({ prefix: keys.cardsPrefix(boardId) })) {
    cards.push(entry.value);
  }
  return cards;
}

async function unmetDependencies(kv: Deno.Kv, boardId: string, card: Card): Promise<string[]> {
  const unmet: string[] = [];
  for (const depId of card.dependsOn) {
    const dep = await kv.get<Card>(keys.card(boardId, depId));
    if (!dep.value || dep.value.status !== "done") unmet.push(depId);
  }
  return unmet;
}

// Pragmatic glob-overlap check: compares each pattern's fixed prefix (the
// part before the first wildcard character). Two scopes conflict if one
// prefix contains the other — "src/api/**" and "src/api/handlers.ts"
// conflict, "src/api/**" and "src/web/**" don't. Full glob-set intersection
// is real hardening work (plan section 8, M6); this catches the common
// same-directory case cheaply.
function globPrefix(pattern: string): string {
  const idx = pattern.search(/[*?[{]/);
  return idx === -1 ? pattern : pattern.slice(0, idx);
}

function scopesOverlap(a: string[], b: string[]): boolean {
  for (const pa of a) {
    const prefixA = globPrefix(pa);
    for (const pb of b) {
      const prefixB = globPrefix(pb);
      if (prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA)) return true;
    }
  }
  return false;
}

function findScopeConflict(candidate: Card, inProgress: Card[]): Card | null {
  for (const other of inProgress) {
    if (other.id === candidate.id) continue;
    if (scopesOverlap(candidate.fileScope, other.fileScope)) return other;
  }
  return null;
}

// ---------- Cards: create ----------

export async function createCard(
  kv: Deno.Kv,
  boardId: string,
  input: {
    title: string;
    description: string;
    priority?: number;
    dependsOn?: string[];
    fileScope?: string[];
    acceptance?: string[];
  },
): Promise<Card> {
  const dependsOn = input.dependsOn ?? [];
  if (dependsOn.length > 0) {
    const deps = await Promise.all(dependsOn.map((id) => kv.get<Card>(keys.card(boardId, id))));
    const unknown = dependsOn.filter((_, i) => deps[i].value === null);
    if (unknown.length > 0) {
      throw new Error(`unknown dependsOn card(s): ${unknown.join(", ")}`);
    }
  }
  const now = Date.now();
  const card: Card = {
    id: monotonicUlid(),
    boardId,
    title: input.title,
    description: input.description,
    status: dependsOn.length > 0 ? "backlog" : "ready",
    priority: input.priority ?? 100,
    dependsOn,
    fileScope: input.fileScope ?? [],
    acceptance: input.acceptance ?? [],
    createdAt: now,
    updatedAt: now,
  };
  const event = makeEvent(boardId, "card.created", "system", card.id, card.title);
  const res = await kv.atomic()
    .set(keys.card(boardId, card.id), card)
    .set(keys.cardByStatus(boardId, card.status, card.id), card.id)
    .set(keys.event(boardId, event.id), event)
    .commit();
  if (!res.ok) throw new Error("failed to create card");
  return card;
}

// ---------- Cards: claim ----------

export type ClaimNearMiss =
  | { cardId: string; title: string; reason: "dependency_unmet"; blockedBy: string[] }
  | { cardId: string; title: string; reason: "scope_conflict"; conflictsWith: string };

export type ClaimResult =
  | { ok: true; card: Card }
  | { ok: false; message: string; nearMisses: ClaimNearMiss[] };

// The one place a card actually flips from "ready" to "in_progress". Reads
// fresh (never trusts a caller-supplied snapshot) and lets kv.atomic()'s
// .check() decide the race — if another caller claimed it first, the
// versionstamp check fails, .commit() reports !ok, and we return null so
// the caller can try the next candidate instead of erroring out. Also
// checks the agent record exists and updates its currentCardId/status in
// the same atomic transaction, so a card is never claimed by an agent the
// board doesn't know about, and get_team_status is never stale mid-claim.
async function tryClaim(kv: Deno.Kv, boardId: string, cardId: string, agentId: string, leaseMs: number): Promise<Card | null> {
  const [cardEntry, agentEntry] = await Promise.all([
    kv.get<Card>(keys.card(boardId, cardId)),
    kv.get<Agent>(keys.agent(boardId, agentId)),
  ]);
  if (!agentEntry.value || !cardEntry.value || cardEntry.value.status !== "ready") return null;

  const now = Date.now();
  const updatedCard: Card = {
    ...cardEntry.value,
    status: "in_progress",
    assignee: agentId,
    leaseExpiresAt: now + leaseMs,
    updatedAt: now,
  };
  const updatedAgent: Agent = { ...agentEntry.value, currentCardId: cardId, status: "working", lastHeartbeatAt: now };
  const event = makeEvent(boardId, "card.claimed", agentId, cardId, `claimed by ${agentEntry.value.name}`);
  const res = await kv.atomic()
    .check(cardEntry)
    .check(agentEntry)
    .delete(keys.cardByStatus(boardId, "ready", cardId))
    .set(keys.card(boardId, cardId), updatedCard)
    .set(keys.cardByStatus(boardId, "in_progress", cardId), cardId)
    .set(keys.cardByAgent(boardId, agentId, cardId), cardId)
    .set(keys.agent(boardId, agentId), updatedAgent)
    .set(keys.event(boardId, event.id), event)
    .commit();
  return res.ok ? updatedCard : null;
}

export async function claimNextCard(kv: Deno.Kv, boardId: string, agentId: string): Promise<ClaimResult> {
  const board = await getBoardById(kv, boardId);
  if (!board) return { ok: false, message: `unknown board: ${boardId}`, nearMisses: [] };
  if (!(await getAgent(kv, boardId, agentId))) {
    return { ok: false, message: `unknown agent: ${agentId} (register first)`, nearMisses: [] };
  }
  const leaseMs = board.leaseMs ?? DEFAULT_LEASE_MS;

  const readyCards = await listCardsByStatus(kv, boardId, "ready");
  readyCards.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  const inProgress = await listCardsByStatus(kv, boardId, "in_progress");

  const nearMisses: ClaimNearMiss[] = [];
  for (const candidate of readyCards) {
    const conflict = findScopeConflict(candidate, inProgress);
    if (conflict) {
      nearMisses.push({ cardId: candidate.id, title: candidate.title, reason: "scope_conflict", conflictsWith: conflict.id });
      continue;
    }
    const claimed = await tryClaim(kv, boardId, candidate.id, agentId, leaseMs);
    if (claimed) return { ok: true, card: claimed };
    // Lost the race for this one (claimed by a concurrent caller between
    // our list scan and the attempt) — fall through to the next candidate.
  }

  // Nothing claimable — explain why, so an agent (or a human) can see
  // "waiting on card X" instead of a bare "nothing to do."
  const backlog = await listCardsByStatus(kv, boardId, "backlog");
  for (const card of backlog) {
    const unmet = await unmetDependencies(kv, boardId, card);
    if (unmet.length > 0) nearMisses.push({ cardId: card.id, title: card.title, reason: "dependency_unmet", blockedBy: unmet });
  }

  return { ok: false, message: "no eligible card", nearMisses };
}

export async function claimCard(kv: Deno.Kv, boardId: string, agentId: string, cardId: string): Promise<ClaimResult> {
  const board = await getBoardById(kv, boardId);
  if (!board) return { ok: false, message: `unknown board: ${boardId}`, nearMisses: [] };
  if (!(await getAgent(kv, boardId, agentId))) {
    return { ok: false, message: `unknown agent: ${agentId} (register first)`, nearMisses: [] };
  }

  const entry = await kv.get<Card>(keys.card(boardId, cardId));
  if (!entry.value) return { ok: false, message: `unknown card: ${cardId}`, nearMisses: [] };
  if (entry.value.status !== "ready") {
    return { ok: false, message: `card ${cardId} is not ready (status: ${entry.value.status})`, nearMisses: [] };
  }

  const unmet = await unmetDependencies(kv, boardId, entry.value);
  if (unmet.length > 0) {
    return {
      ok: false,
      message: `card ${cardId} has unmet dependencies: ${unmet.join(", ")}`,
      nearMisses: [{ cardId, title: entry.value.title, reason: "dependency_unmet", blockedBy: unmet }],
    };
  }

  const inProgress = await listCardsByStatus(kv, boardId, "in_progress");
  const conflict = findScopeConflict(entry.value, inProgress);
  if (conflict) {
    return {
      ok: false,
      message: `claim failed: fileScope overlaps card ${conflict.id} held by ${conflict.assignee}`,
      nearMisses: [{ cardId, title: entry.value.title, reason: "scope_conflict", conflictsWith: conflict.id }],
    };
  }

  const leaseMs = board.leaseMs ?? DEFAULT_LEASE_MS;
  const claimed = await tryClaim(kv, boardId, cardId, agentId, leaseMs);
  if (!claimed) return { ok: false, message: `claim failed: card ${cardId} was claimed by someone else`, nearMisses: [] };
  return { ok: true, card: claimed };
}

// ---------- Cards: progress / move / complete / release ----------

const MAX_PATCH_RETRIES = 8;

// Generic atomic read-modify-write for an existing card: re-reads fresh
// each attempt (never trusts a stale snapshot), lets `mutate` compute the
// next state (it may throw a domain error — e.g. "not assigned to you" —
// which propagates immediately, not retried, since that's a rule
// violation, not a concurrency conflict), diffs status/assignee to keep
// both secondary indexes in sync, and appends the event in the same
// transaction. Retries only on a lost versionstamp race.
async function atomicPatchCard(
  kv: Deno.Kv,
  boardId: string,
  cardId: string,
  mutate: (card: Card) => Card,
  event: { type: EventType; actor: string; detail?: string },
): Promise<Card> {
  for (let attempt = 0; attempt < MAX_PATCH_RETRIES; attempt++) {
    const entry = await kv.get<Card>(keys.card(boardId, cardId));
    if (!entry.value) throw new Error(`unknown card: ${cardId}`);
    const before = entry.value;
    const after = mutate(before);
    const evt = makeEvent(boardId, event.type, event.actor, cardId, event.detail);

    let tx = kv.atomic().check(entry).set(keys.card(boardId, cardId), after).set(keys.event(boardId, evt.id), evt);
    if (before.status !== after.status) {
      tx = tx.delete(keys.cardByStatus(boardId, before.status, cardId)).set(keys.cardByStatus(boardId, after.status, cardId), cardId);
    }
    if (before.assignee !== after.assignee) {
      if (before.assignee) tx = tx.delete(keys.cardByAgent(boardId, before.assignee, cardId));
      if (after.assignee) tx = tx.set(keys.cardByAgent(boardId, after.assignee, cardId), cardId);
    }

    const res = await tx.commit();
    if (res.ok) return after;
    // Someone else wrote this card between our read and commit — retry
    // against a fresh read rather than clobbering their change.
  }
  throw new Error(`card ${cardId} update conflicted too many times`);
}

export async function updateCardProgress(kv: Deno.Kv, boardId: string, cardId: string, agentId: string, note: string): Promise<Card> {
  const board = await getBoardById(kv, boardId);
  const leaseMs = board?.leaseMs ?? DEFAULT_LEASE_MS;
  return atomicPatchCard(
    kv,
    boardId,
    cardId,
    (card) => {
      if (card.assignee !== agentId) throw new Error(`card ${cardId} is not assigned to ${agentId}`);
      return { ...card, updatedAt: Date.now(), leaseExpiresAt: Date.now() + leaseMs };
    },
    { type: "card.progress", actor: agentId, detail: note },
  );
}

export async function moveCard(
  kv: Deno.Kv,
  boardId: string,
  cardId: string,
  agentId: string,
  status: CardStatus,
  detail?: string,
): Promise<Card> {
  const card = await atomicPatchCard(
    kv,
    boardId,
    cardId,
    (card) => {
      if (card.assignee && card.assignee !== agentId) throw new Error(`card ${cardId} is held by ${card.assignee}`);
      return { ...card, status, updatedAt: Date.now() };
    },
    { type: "card.moved", actor: agentId, detail: detail ?? `-> ${status}` },
  );
  // Blocked cards "keep their assignee but release their lease pressure"
  // (plan section 4) — the card stays with the agent, but the agent's own
  // status reflects that it can't currently make progress. Moving back out
  // of blocked (to in_progress) restores "working".
  if (card.assignee) {
    if (status === "blocked") await setAgentCurrentCard(kv, boardId, card.assignee, cardId, "blocked");
    else if (status === "in_progress") await setAgentCurrentCard(kv, boardId, card.assignee, cardId, "working");
  }
  return card;
}

export async function completeCard(
  kv: Deno.Kv,
  boardId: string,
  cardId: string,
  agentId: string,
  result: string,
  branch?: string,
): Promise<Card> {
  const card = await atomicPatchCard(
    kv,
    boardId,
    cardId,
    (card) => {
      if (card.assignee !== agentId) throw new Error(`card ${cardId} is not assigned to ${agentId}`);
      return {
        ...card,
        status: "done",
        result,
        branch: branch ?? card.branch,
        assignee: undefined,
        leaseExpiresAt: undefined,
        updatedAt: Date.now(),
      };
    },
    { type: "card.completed", actor: agentId, detail: result },
  );
  await setAgentCurrentCard(kv, boardId, agentId, undefined, "idle");
  await unblockDependents(kv, boardId, cardId);
  return card;
}

export async function releaseCard(kv: Deno.Kv, boardId: string, cardId: string, agentId: string, reason: string): Promise<Card> {
  const card = await atomicPatchCard(
    kv,
    boardId,
    cardId,
    (card) => {
      if (card.assignee !== agentId) throw new Error(`card ${cardId} is not assigned to ${agentId}`);
      return { ...card, status: "ready", assignee: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() };
    },
    { type: "card.released", actor: agentId, detail: reason },
  );
  await setAgentCurrentCard(kv, boardId, agentId, undefined, "idle");
  return card;
}

// Dependency gating: a card sitting in "backlog" waiting on the card that
// just completed moves to "ready" once *all* of its dependencies are done.
// Best-effort — if a concurrent writer touches the same dependent card in
// this same window, we just skip it; the next dependency completion (or a
// future M2 reconciliation pass) will re-check it.
async function unblockDependents(kv: Deno.Kv, boardId: string, completedCardId: string): Promise<void> {
  const backlog = await listCardsByStatus(kv, boardId, "backlog");
  for (const card of backlog) {
    if (!card.dependsOn.includes(completedCardId)) continue;
    const unmet = await unmetDependencies(kv, boardId, card);
    if (unmet.length > 0) continue;
    try {
      await atomicPatchCard(
        kv,
        boardId,
        card.id,
        (c) => ({ ...c, status: "ready", updatedAt: Date.now() }),
        { type: "card.moved", actor: "system", detail: "dependencies satisfied" },
      );
    } catch {
      // Lost a race or card changed underneath us — not fatal, see above.
    }
  }
}

// ---------- Agents ----------

export async function getAgent(kv: Deno.Kv, boardId: string, agentId: string): Promise<Agent | null> {
  const entry = await kv.get<Agent>(keys.agent(boardId, agentId));
  return entry.value;
}

export async function listAgents(kv: Deno.Kv, boardId: string): Promise<Agent[]> {
  const agents: Agent[] = [];
  for await (const entry of kv.list<Agent>({ prefix: keys.agentsPrefix(boardId) })) agents.push(entry.value);
  return agents;
}

// Upserts by name within the board — idempotent, so a session that
// reconnects (or a --resume'd Claude Code session) can re-register with the
// same name and reclaim its identity rather than accumulating duplicate
// agent records. Races on a brand-new name are resolved the same way slug
// uniqueness is: .check() the name index, and if we lose, retry — the
// retry will find the name now taken and fall into the upsert branch.
export async function registerAgent(
  kv: Deno.Kv,
  boardId: string,
  input: { name: string; role: string; meta?: Record<string, string> },
): Promise<Agent> {
  const nameKey = keys.agentByName(boardId, input.name);
  for (let attempt = 0; attempt < MAX_PATCH_RETRIES; attempt++) {
    const nameEntry = await kv.get<string>(nameKey);

    if (nameEntry.value) {
      const agentEntry = await kv.get<Agent>(keys.agent(boardId, nameEntry.value));
      if (!agentEntry.value) continue; // index pointed at a missing record — retry and self-heal
      const updated: Agent = {
        ...agentEntry.value,
        role: input.role,
        status: "idle",
        lastHeartbeatAt: Date.now(),
        meta: input.meta ?? agentEntry.value.meta,
      };
      const res = await kv.atomic().check(agentEntry).set(keys.agent(boardId, updated.id), updated).commit();
      if (res.ok) return updated;
      continue;
    }

    const agent: Agent = {
      id: monotonicUlid(),
      boardId,
      name: input.name,
      role: input.role,
      status: "idle",
      lastHeartbeatAt: Date.now(),
      registeredAt: Date.now(),
      meta: input.meta,
    };
    const event = makeEvent(boardId, "agent.registered", agent.id, undefined, `${agent.name} (${agent.role}) registered`);
    const res = await kv.atomic()
      .check(nameEntry)
      .set(keys.agent(boardId, agent.id), agent)
      .set(nameKey, agent.id)
      .set(keys.agentBoardIndex(agent.id), boardId)
      .set(keys.event(boardId, event.id), event)
      .commit();
    if (res.ok) return agent;
    // Lost the race for this name — next attempt finds it taken and upserts.
  }
  throw new Error(`register agent ${input.name} conflicted too many times`);
}

// Global reverse lookup ("which board is this agent on") — the MCP layer
// (M3) uses this to resolve a board from a bare agent_id when the tool call
// doesn't carry an explicit board argument. Not board-scoped by design.
export async function getAgentBoardId(kv: Deno.Kv, agentId: string): Promise<string | null> {
  const entry = await kv.get<string>(keys.agentBoardIndex(agentId));
  return entry.value;
}

export interface HeartbeatResult {
  agent: Agent;
  unreadMessages: number; // undrained inbox + unread broadcasts, combined
  newEvents: number; // events past this agent's watch_events cursor
}

// "Any progress update or heartbeat from the assignee extends the lease"
// (plan section 4) — so heartbeat renews the lease on whatever card this
// agent currently holds, in the same transaction as the liveness bump. Also
// doubles as the "anything I should know?" cheap ping (plan section 5):
// counts unread messages and new events without draining/advancing either
// cursor — that only happens when the agent actually calls check_messages /
// watch_events.
export async function heartbeat(kv: Deno.Kv, boardId: string, agentId: string, status?: AgentStatus): Promise<HeartbeatResult> {
  const board = await getBoardById(kv, boardId);
  if (!board) throw new Error(`unknown board: ${boardId}`);
  const leaseMs = board.leaseMs ?? DEFAULT_LEASE_MS;

  let updatedAgent: Agent | null = null;
  for (let attempt = 0; attempt < MAX_PATCH_RETRIES && !updatedAgent; attempt++) {
    const entry = await kv.get<Agent>(keys.agent(boardId, agentId));
    if (!entry.value) throw new Error(`unknown agent: ${agentId}`);
    const updated: Agent = { ...entry.value, lastHeartbeatAt: Date.now(), status: status ?? entry.value.status };

    let tx = kv.atomic().check(entry).set(keys.agent(boardId, agentId), updated);
    if (updated.currentCardId) {
      const cardEntry = await kv.get<Card>(keys.card(boardId, updated.currentCardId));
      if (cardEntry.value && cardEntry.value.assignee === agentId && cardEntry.value.status === "in_progress") {
        tx = tx.check(cardEntry).set(keys.card(boardId, updated.currentCardId), {
          ...cardEntry.value,
          leaseExpiresAt: Date.now() + leaseMs,
        });
      }
    }

    const res = await tx.commit();
    if (res.ok) updatedAgent = updated;
  }
  if (!updatedAgent) throw new Error(`heartbeat for agent ${agentId} conflicted too many times`);

  const [inbox, broadcastCursorEntry, eventsCursorEntry] = await Promise.all([
    listInbox(kv, boardId, agentId),
    kv.get<string>(keys.broadcastCursor(boardId, agentId)),
    kv.get<string>(keys.cursor(boardId, agentId)),
  ]);
  const [newBroadcasts, newEvents] = await Promise.all([
    listNewBroadcasts(kv, boardId, broadcastCursorEntry.value),
    listEvents(kv, boardId, eventsCursorEntry.value ?? undefined),
  ]);

  return { agent: updatedAgent, unreadMessages: inbox.length + newBroadcasts.length, newEvents: newEvents.length };
}

// Best-effort agent-side update after a card transition (complete/release/
// move) has already committed. Not folded into atomicPatchCard's single
// transaction because that helper is card-only and generic across four
// different operations — deliberately simple for now. If this write is
// lost to a race or the process dies right here, the card's own state
// (source of truth) is already correct; the agent record is merely stale
// until its next heartbeat or claim self-heals it. Silently no-ops if the
// agent record doesn't exist, since claim is the only place that currently
// *requires* one — a card can still be released/completed by whatever
// agentId claimed it even in tests that don't go through registerAgent.
async function setAgentCurrentCard(
  kv: Deno.Kv,
  boardId: string,
  agentId: string,
  cardId: string | undefined,
  status: AgentStatus,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_PATCH_RETRIES; attempt++) {
    const entry = await kv.get<Agent>(keys.agent(boardId, agentId));
    if (!entry.value) return;
    const updated: Agent = { ...entry.value, currentCardId: cardId, status };
    const res = await kv.atomic().check(entry).set(keys.agent(boardId, agentId), updated).commit();
    if (res.ok) return;
  }
}

// ---------- Reaper: liveness + lease expiry ----------

export interface SweepResult {
  agentsMarkedOffline: string[];
  cardsReleased: string[];
}

// A handful of missed heartbeats, not just one late one — a single slow
// tool call shouldn't flip an agent offline.
const OFFLINE_MISSED_HEARTBEATS = 3;

// One pass over one board: mark stale agents offline, release in-progress
// cards whose lease expired back to "ready". Cards in "blocked" are a
// different status entirely, so listCardsByStatus(..., "in_progress")
// already excludes them — "the reaper ignores blocked" falls out for free.
export async function sweepBoard(kv: Deno.Kv, board: Board): Promise<SweepResult> {
  const now = Date.now();
  const heartbeatMs = board.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const offlineThresholdMs = heartbeatMs * OFFLINE_MISSED_HEARTBEATS;
  const result: SweepResult = { agentsMarkedOffline: [], cardsReleased: [] };

  const agents = await listAgents(kv, board.id);
  for (const agent of agents) {
    if (agent.status === "offline" || now - agent.lastHeartbeatAt <= offlineThresholdMs) continue;
    const entry = await kv.get<Agent>(keys.agent(board.id, agent.id));
    if (!entry.value || entry.value.status === "offline") continue;
    const updated: Agent = { ...entry.value, status: "offline" };
    const event = makeEvent(board.id, "agent.offline", "system", undefined, `${agent.name} missed heartbeat threshold`);
    const res = await kv.atomic().check(entry).set(keys.agent(board.id, agent.id), updated).set(keys.event(board.id, event.id), event)
      .commit();
    if (res.ok) result.agentsMarkedOffline.push(agent.id);
  }

  const inProgress = await listCardsByStatus(kv, board.id, "in_progress");
  for (const card of inProgress) {
    if (!card.leaseExpiresAt || card.leaseExpiresAt > now) continue;
    const entry = await kv.get<Card>(keys.card(board.id, card.id));
    if (!entry.value || entry.value.status !== "in_progress" || !entry.value.leaseExpiresAt || entry.value.leaseExpiresAt > now) {
      continue;
    }
    const releasedAgent = entry.value.assignee;
    const updated: Card = { ...entry.value, status: "ready", assignee: undefined, leaseExpiresAt: undefined, updatedAt: now };
    const event = makeEvent(
      board.id,
      "card.lease_expired",
      "system",
      card.id,
      releasedAgent ? `lease expired, released from ${releasedAgent}` : "lease expired",
    );
    let tx = kv.atomic()
      .check(entry)
      .delete(keys.cardByStatus(board.id, "in_progress", card.id))
      .set(keys.card(board.id, card.id), updated)
      .set(keys.cardByStatus(board.id, "ready", card.id), card.id)
      .set(keys.event(board.id, event.id), event);
    if (releasedAgent) tx = tx.delete(keys.cardByAgent(board.id, releasedAgent, card.id));
    const res = await tx.commit();
    if (res.ok) {
      result.cardsReleased.push(card.id);
      if (releasedAgent) await setAgentCurrentCard(kv, board.id, releasedAgent, undefined, "idle");
    }
  }

  return result;
}

const REAPER_TICK_MS = 15_000;
let reaperTimer: ReturnType<typeof setInterval> | undefined;

// In-process setInterval reaper (plan section 4) — iterates every
// non-archived board on each tick. sweepBoard() is exported separately so
// tests can drive a single sweep deterministically instead of waiting on
// a real 15s interval.
export function startReaper(kv: Deno.Kv): void {
  if (reaperTimer) return;
  const tick = async () => {
    const boards = await listBoards(kv);
    for (const board of boards) await sweepBoard(kv, board);
  };
  tick();
  reaperTimer = setInterval(tick, REAPER_TICK_MS);
}

// ---------- Summaries (shared by REST's board list and MCP's list_boards/get_board_status) ----------

export interface BoardSummary extends Board {
  cardCount: number;
  openCardCount: number;
  activeAgentCount: number;
}

export async function listBoardSummaries(kv: Deno.Kv): Promise<BoardSummary[]> {
  const boards = await listBoards(kv);
  return await Promise.all(boards.map(async (board) => {
    const [cards, agents] = await Promise.all([listCards(kv, board.id), listAgents(kv, board.id)]);
    return {
      ...board,
      cardCount: cards.length,
      openCardCount: cards.filter((c) => c.status !== "done").length,
      activeAgentCount: agents.filter((a) => a.status !== "offline").length,
    };
  }));
}

export interface BoardStatus {
  board: Board;
  columns: Record<CardStatus, number>;
  totalAgents: number;
  activeAgents: number;
  queueDepth: number; // "ready" count — claimable right now
}

export async function getBoardStatus(kv: Deno.Kv, boardId: string): Promise<BoardStatus> {
  const board = await getBoardById(kv, boardId);
  if (!board) throw new Error(`unknown board: ${boardId}`);
  const [cards, agents] = await Promise.all([listCards(kv, boardId), listAgents(kv, boardId)]);
  const columns: Record<CardStatus, number> = { backlog: 0, ready: 0, in_progress: 0, review: 0, done: 0, blocked: 0 };
  for (const card of cards) columns[card.status]++;
  return {
    board,
    columns,
    totalAgents: agents.length,
    activeAgents: agents.filter((a) => a.status !== "offline").length,
    queueDepth: columns.ready,
  };
}

// ---------- Messaging ----------
//
// Pull-based (plan section 3): there's no push channel into a Claude Code
// session, so agents poll at natural checkpoints. Inbox messages (to a
// specific agent) are deleted once read. Broadcasts ("*") are a shared ring
// buffer — every agent reads the same records, so instead of deleting on
// read, each agent tracks its own cursor into the ring.

async function listInbox(kv: Deno.Kv, boardId: string, agentId: string): Promise<Message[]> {
  const messages: Message[] = [];
  for await (const entry of kv.list<Message>({ prefix: keys.inboxPrefix(boardId, agentId) })) messages.push(entry.value);
  return messages;
}

// Same "start is inclusive, sinceId is exclusive" shape as listEvents.
async function listNewBroadcasts(kv: Deno.Kv, boardId: string, sinceId: string | null): Promise<Message[]> {
  const selector: Deno.KvListSelector = sinceId
    ? { prefix: keys.broadcastPrefix(boardId), start: keys.broadcast(boardId, sinceId) }
    : { prefix: keys.broadcastPrefix(boardId) };
  const messages: Message[] = [];
  for await (const entry of kv.list<Message>(selector)) {
    if (sinceId && entry.value.id === sinceId) continue;
    messages.push(entry.value);
  }
  return messages;
}

const MAX_BROADCAST_RING = 200;

// Best-effort trim, run after a broadcast send — not part of the send's own
// atomic transaction (it's a housekeeping concern, not a correctness one: a
// ring briefly holding 201 messages instead of 200 is harmless).
async function trimBroadcastRing(kv: Deno.Kv, boardId: string): Promise<void> {
  const ids: string[] = [];
  for await (const entry of kv.list<Message>({ prefix: keys.broadcastPrefix(boardId) })) ids.push(entry.value.id);
  if (ids.length <= MAX_BROADCAST_RING) return;
  ids.sort(); // ULIDs sort chronologically
  for (const id of ids.slice(0, ids.length - MAX_BROADCAST_RING)) await kv.delete(keys.broadcast(boardId, id));
}

export async function sendMessage(
  kv: Deno.Kv,
  boardId: string,
  input: { from: string; to: string; cardId?: string; body: string },
): Promise<Message> {
  if (!(await getAgent(kv, boardId, input.from))) throw new Error(`unknown agent: ${input.from}`);
  if (input.to !== "*" && !(await getAgent(kv, boardId, input.to))) throw new Error(`unknown agent: ${input.to}`);

  const message: Message = {
    id: monotonicUlid(),
    boardId,
    from: input.from,
    to: input.to,
    cardId: input.cardId,
    body: input.body,
    createdAt: Date.now(),
  };
  const event = makeEvent(boardId, "message.sent", input.from, input.cardId, `to ${input.to}: ${input.body.slice(0, 80)}`);
  const messageKey = input.to === "*" ? keys.broadcast(boardId, message.id) : keys.inbox(boardId, input.to, message.id);
  const res = await kv.atomic().set(messageKey, message).set(keys.event(boardId, event.id), event).commit();
  if (!res.ok) throw new Error("failed to send message");

  if (input.to === "*") await trimBroadcastRing(kv, boardId);
  return message;
}

// Drains the caller's inbox (deleting each message) and advances its
// broadcast cursor past whatever's newly returned. Merged oldest-first —
// ULID string comparison is chronological, so a plain sort suffices.
export async function checkMessages(kv: Deno.Kv, boardId: string, agentId: string): Promise<Message[]> {
  const inbox = await listInbox(kv, boardId, agentId);
  for (const message of inbox) await kv.delete(keys.inbox(boardId, agentId, message.id));

  const cursorEntry = await kv.get<string>(keys.broadcastCursor(boardId, agentId));
  const broadcasts = await listNewBroadcasts(kv, boardId, cursorEntry.value);
  if (broadcasts.length > 0) await kv.set(keys.broadcastCursor(boardId, agentId), broadcasts[broadcasts.length - 1].id);

  return [...inbox, ...broadcasts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Events after the agent's stored cursor, or an explicit ULID if given
// (letting a caller replay from an arbitrary point without disturbing its
// stored position going forward) — then advances the cursor to the last
// event returned. Poll-based awareness feed (plan section 5).
export async function watchEvents(kv: Deno.Kv, boardId: string, agentId: string, since?: string): Promise<BoardEvent[]> {
  const cursorEntry = await kv.get<string>(keys.cursor(boardId, agentId));
  const events = await listEvents(kv, boardId, since ?? cursorEntry.value ?? undefined);
  if (events.length > 0) await kv.set(keys.cursor(boardId, agentId), events[events.length - 1].id);
  return events;
}

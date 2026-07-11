// Board-scoped service layer for orchestration. Every mutation goes through
// a single kv.atomic() that checks a versionstamp, writes the record,
// maintains secondary indexes, and appends an event — never a partial
// write. REST routes and (later) MCP tools both call these functions
// directly, so there's exactly one place coordination rules live.
//
// Scope note: this file covers M1 (core store: boards, cards, atomic claim,
// events) per the build order in agent-kanban-orchestration-plan-v2-1.md.
// Agents/heartbeats/reaper (M2), the MCP surface (M3), and messaging (M4)
// are not implemented yet — claim functions take a bare agentId string
// rather than requiring a registered Agent record.

import { monotonicUlid } from "jsr:@std/ulid";
import { keys } from "./kv.ts";
import { type Board, type BoardEvent, type Card, type CardStatus, DEFAULT_LEASE_MS, type EventType } from "./types.ts";

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
// the caller can try the next candidate instead of erroring out.
async function tryClaim(kv: Deno.Kv, boardId: string, cardId: string, agentId: string, leaseMs: number): Promise<Card | null> {
  const entry = await kv.get<Card>(keys.card(boardId, cardId));
  if (!entry.value || entry.value.status !== "ready") return null;
  const now = Date.now();
  const updated: Card = { ...entry.value, status: "in_progress", assignee: agentId, leaseExpiresAt: now + leaseMs, updatedAt: now };
  const event = makeEvent(boardId, "card.claimed", agentId, cardId, `claimed by ${agentId}`);
  const res = await kv.atomic()
    .check(entry)
    .delete(keys.cardByStatus(boardId, "ready", cardId))
    .set(keys.card(boardId, cardId), updated)
    .set(keys.cardByStatus(boardId, "in_progress", cardId), cardId)
    .set(keys.cardByAgent(boardId, agentId, cardId), cardId)
    .set(keys.event(boardId, event.id), event)
    .commit();
  return res.ok ? updated : null;
}

export async function claimNextCard(kv: Deno.Kv, boardId: string, agentId: string): Promise<ClaimResult> {
  const board = await getBoardById(kv, boardId);
  if (!board) return { ok: false, message: `unknown board: ${boardId}`, nearMisses: [] };
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
  return atomicPatchCard(
    kv,
    boardId,
    cardId,
    (card) => {
      if (card.assignee && card.assignee !== agentId) throw new Error(`card ${cardId} is held by ${card.assignee}`);
      return { ...card, status, updatedAt: Date.now() };
    },
    { type: "card.moved", actor: agentId, detail: detail ?? `-> ${status}` },
  );
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
  await unblockDependents(kv, boardId, cardId);
  return card;
}

export async function releaseCard(kv: Deno.Kv, boardId: string, cardId: string, agentId: string, reason: string): Promise<Card> {
  return atomicPatchCard(
    kv,
    boardId,
    cardId,
    (card) => {
      if (card.assignee !== agentId) throw new Error(`card ${cardId} is not assigned to ${agentId}`);
      return { ...card, status: "ready", assignee: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() };
    },
    { type: "card.released", actor: agentId, detail: reason },
  );
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

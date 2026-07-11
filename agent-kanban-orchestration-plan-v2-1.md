# Agent Kanban: Build Plan

A headless, multi-board Kanban server with an MCP endpoint for orchestrating multiple Claude Code sessions that are aware of each other. One daemon hosts many boards — typically one per repo or project. No UI — each board is an API surface consumed by agents (via MCP) and by an operator/orchestrator (via REST). Visual layers can attach later through the same REST/SSE surface.

**Stack:** Deno, Hono (single process serving REST + MCP over Streamable HTTP), Deno KV for storage, ULIDs for identifiers, optimistic concurrency via atomic `.check()` transactions.

---

## 1. Goals and non-goals

**Goals**

- A shared source of truth for work items (cards) that multiple Claude Code sessions can claim, progress, and complete without stepping on each other.
- Mutual awareness: any session can discover who else is active, what they're working on, and what has recently changed.
- Direct and broadcast messaging between sessions.
- Race-free claiming, crash recovery via leases, and dependency gating.
- Simple enough that a fresh Claude Code session can learn the whole protocol from a short CLAUDE.md section.
- Host many isolated boards on one server, so a single long-running daemon serves every project on the machine.

**Non-goals (for now)**

- No web UI, no rendering, no charts.
- No auth beyond a shared bearer token (single-machine / trusted network assumption).
- No cross-board dependencies, messaging, or agent identity in v1 — boards are fully isolated namespaces.

---

## 2. Architecture overview

One Deno process, one port. Hono routes split into three groups:

```
/mcp?board=<slug>               → MCP Streamable HTTP (agents; board pinned per connection)
/api/boards                     → board management (create, list, archive)
/api/boards/:board/*            → REST mirror of all operations, per board
/api/boards/:board/events/stream → SSE tail of that board's event log
```

The server hosts multiple boards — isolated namespaces, typically one per repo. All state lives in Deno KV, keyed under a board ID. Every mutation goes through an atomic transaction and appends an event to the owning board's append-only log. The event log is the backbone of awareness: agents poll it with a cursor, humans tail it over SSE.

Claude Code sessions connect as MCP clients via a project-scoped `.mcp.json`. Each session registers itself as an **agent**, then runs a work loop: claim → work → progress-update → complete → check inbox → repeat.

---

## 3. Data model

### Board

Boards are isolated namespaces: cards, agents, messages, events, and cursors each belong to exactly one board, and nothing crosses board lines in v1.

```ts
interface Board {
  id: string;                 // ULID
  slug: string;               // unique, URL-safe handle, e.g. "egg-hunt"
  title: string;
  description?: string;
  leaseMs?: number;           // per-board override of claim lease duration
  heartbeatMs?: number;       // per-board override of liveness threshold
  createdAt: number;
  archivedAt?: number;        // archived boards are read-only and hidden from lists
}
```

Slug uniqueness uses the same atomic pattern as everything else: the create transaction `.check()`s that `["idx", "boards_by_slug", slug]` is absent before writing both keys. All records below additionally carry a `boardId` field and are keyed under it, so records are self-describing and per-board range scans stay cheap.

### Card

```ts
type CardStatus = "backlog" | "ready" | "in_progress" | "review" | "done" | "blocked";

interface Card {
  id: string;                 // ULID
  title: string;
  description: string;        // full task brief, written for an agent audience
  status: CardStatus;
  priority: number;           // lower = more urgent
  dependsOn: string[];        // card IDs that must be "done" before this is claimable
  fileScope: string[];        // glob paths this card owns, e.g. ["src/api/**"]
  branch?: string;            // git branch / worktree name convention: card/<id-short>
  acceptance: string[];       // done-when criteria, checkable by the agent
  assignee?: string;          // agent ID currently holding the claim
  leaseExpiresAt?: number;    // epoch ms; claim is void after this
  result?: string;            // completion summary written by the agent
  createdAt: number;
  updatedAt: number;
}
```

Notes on intent:

- `fileScope` is the conflict-prevention primitive. Claiming is refused (or flagged) if the scope overlaps another `in_progress` card. This encodes the "assign clear boundaries" rule directly into the board instead of relying on prompt discipline.
- `dependsOn` gates claimability. A card in `ready` with unmet dependencies is invisible to `claim_next_card`.
- `acceptance` gives completing agents a checklist and gives reviewing agents (or a reviewer card) something objective.

### Agent

```ts
type AgentStatus = "idle" | "working" | "blocked" | "offline";

interface Agent {
  id: string;                 // ULID, minted at registration
  name: string;               // human-readable, e.g. "backend-worker-1"
  role: string;               // free text: "implementer", "reviewer", "lead"
  status: AgentStatus;
  currentCardId?: string;
  lastHeartbeatAt: number;    // epoch ms
  registeredAt: number;
  meta?: Record<string, string>; // model, worktree path, pid — whatever helps debugging
}
```

### Message

```ts
interface Message {
  id: string;                 // ULID (doubles as time ordering)
  from: string;               // agent ID
  to: string | "*";           // agent ID or broadcast
  cardId?: string;            // optional: message concerns this card
  body: string;
  createdAt: number;
}
```

Messages are pull-based. There is no push channel into a Claude Code session; the protocol (section 7) makes agents poll their inbox at natural checkpoints. Read messages are deleted (inbox semantics), broadcasts are kept in a ring buffer per agent cursor.

### Event

```ts
type EventType =
  | "card.created" | "card.claimed" | "card.moved" | "card.progress"
  | "card.completed" | "card.released" | "card.lease_expired"
  | "agent.registered" | "agent.heartbeat_missed" | "agent.offline"
  | "message.sent";

interface BoardEvent {
  id: string;                 // ULID — cursor-friendly
  type: EventType;
  actor: string;              // agent ID or "system"
  cardId?: string;
  detail?: string;
  createdAt: number;
}
```

### Deno KV key layout

```
["boards", boardId]                                 → Board
["idx", "boards_by_slug", slug]                     → boardId
["cards", boardId, cardId]                          → Card
["idx", boardId, "cards_by_status", status, cardId] → cardId (secondary index)
["idx", boardId, "cards_by_agent", agentId, cardId] → cardId
["agents", boardId, agentId]                        → Agent
["idx", boardId, "agents_by_name", name]            → agentId (register idempotency)
["inbox", boardId, agentId, messageId]              → Message
["broadcast", boardId, messageId]                   → Message
["events", boardId, eventId]                        → BoardEvent (ULID keys = chronological scans)
["cursors", boardId, agentId, "events"]             → last seen eventId
```

Every mutation is a single `kv.atomic()` that: checks the versionstamp of the primary record, writes the record, maintains indexes, and appends the event. If the `.check()` fails, the operation retries or returns a conflict — never a partial write.

---

## 4. Coordination semantics

**Atomic claim.** `claim_next_card` scans the board's `ready` cards in priority order, filters out cards with unmet `dependsOn` or overlapping `fileScope` against in-progress cards, then attempts an atomic transaction: check card versionstamp, check agent record, set `assignee`, `status = in_progress`, `leaseExpiresAt = now + LEASE_MS`, update both indexes, append `card.claimed`. Losing a race just means retrying against the next candidate. This is the same `.check()` claiming pattern proven in the earlier board — carried forward as the core primitive.

**Leases and the reaper.** Agents heartbeat on an interval (piggybacked on any tool call, plus an explicit `heartbeat` tool). A background `setInterval` reaper (in-process, ~15s tick) iterates every non-archived board and does two sweeps per board, honoring each board's `leaseMs`/`heartbeatMs` overrides: agents whose `lastHeartbeatAt` exceeds the offline threshold are marked `offline`; in-progress cards whose lease expired are released back to `ready` with a `card.lease_expired` event. A crashed or context-exhausted session therefore never strands work — another session picks it up, and the event log tells everyone why.

**Lease renewal.** Any progress update or heartbeat from the assignee extends the lease. Default lease of 10 minutes with 60s heartbeats is a sane starting point; both are overridable per board and tuned in milestone 6.

**Dependency gating.** Completing a card triggers a check for cards whose dependencies just became fully satisfied; those emit a `card.moved` (backlog → ready) event if they were waiting. This gives you cheap DAG-shaped pipelines (implement → test → review) without a scheduler.

**Blocked flow.** An agent that cannot proceed calls `move_card(status: "blocked", detail)` and typically sends a message to the lead or broadcasts. Blocked cards keep their assignee but release their lease pressure (reaper ignores blocked).

---

## 5. MCP server

Transport: Streamable HTTP mounted on the Hono app (the official TypeScript MCP SDK's server transport works under Deno; wrap its request handler in a Hono route). One server, many concurrent Claude Code clients across many boards. Session identity is *application-level* (the `agent_id` returned by `register_agent`), not transport-level, so reconnects and `--resume` sessions can reclaim their identity by name.

**Board resolution.** Every call resolves to exactly one board, in this order: an explicit `board` argument on the tool call → the board bound to the calling `agent_id` → the `?board=<slug>` query param on the connection URL. Since each repo's `.mcp.json` sets its own URL, sessions land on the right board with zero per-call ceremony; explicit `board` arguments exist mainly for orchestrators and cross-project leads.

### Tools

| Tool | Input (summary) | Behavior |
| --- | --- | --- |
| `list_boards` | — | Slug, title, open-card count, and active-agent count for every non-archived board. |
| `create_board` | slug, title, description? | Creates an empty board; atomic slug-uniqueness check. |
| `get_board_status` | board? | One board's summary: column counts, active agents, queue depth. |
| `register_agent` | board?, name, role, meta? | Upserts agent by name within the resolved board, returns `agent_id` + protocol reminder + team snapshot. Idempotent; binds the agent to that board for all later calls. |
| `heartbeat` | agent_id, status? | Bumps `lastHeartbeatAt`, optionally updates status, renews lease. Returns unread-message count and count of new events — a cheap "anything I should know?" ping. |
| `get_team_status` | — | All agents, their status, current cards, staleness. The awareness workhorse. |
| `list_cards` | status?, assignee? | Filtered card summaries (id, title, status, assignee, priority). |
| `get_card` | card_id | Full card, including description, acceptance, scope, recent related events. |
| `create_card` | title, description, priority?, dependsOn?, fileScope?, acceptance? | Creates in `backlog` or `ready` (ready if no deps). Any agent can create — leads decompose work with this. |
| `claim_next_card` | agent_id, role_filter? | Atomic claim of best eligible card, or a structured "nothing eligible" with the reason per near-miss (dep unmet, scope conflict). |
| `claim_card` | agent_id, card_id | Targeted claim, same checks. |
| `update_card_progress` | agent_id, card_id, note | Appends `card.progress` event, renews lease. Cheap and encouraged — this is what makes other sessions' `watch_events` useful. |
| `move_card` | agent_id, card_id, status, detail? | Status transitions with validation (e.g. only assignee or lead moves an in-progress card). |
| `complete_card` | agent_id, card_id, result, branch? | Sets `done`, writes result summary, releases assignee to `idle`, triggers dependency re-check. |
| `release_card` | agent_id, card_id, reason | Voluntary unclaim back to `ready`. |
| `send_message` | from, to (agent_id or "*"), body, card_id? | Delivers to inbox or broadcast ring. |
| `check_messages` | agent_id | Drains inbox + new broadcasts since cursor. Returns messages oldest-first. |
| `watch_events` | agent_id, since? | Events after the agent's cursor (or explicit ULID), advances cursor. Poll-based awareness feed. |

Design rules for the tool layer:

- Every tool response is compact JSON-ish text; token cost is a real constraint when several sessions poll. Summaries by default, full detail only via `get_card`.
- Every mutating tool implicitly heartbeats its caller.
- Errors are structured and actionable ("claim failed: fileScope overlaps card 01J… held by backend-worker-1") because the consumer is a model that will act on the message text.

### Resources and prompts

- MCP resources: `board://{slug}/snapshot` (whole-board summary) and `board://{slug}/card/{id}` for cheap read-only context injection.
- MCP prompt: `worker-briefing` — renders the protocol (section 7) plus current team status, so a fresh session can be onboarded with one prompt reference.

---

## 6. REST API

Thin mirror of the same service layer, for orchestrator scripts and anything that isn't an MCP client:

```
POST   /api/boards                               create board
GET    /api/boards                               list boards (counts, last activity)
GET    /api/boards/:board                        board summary
POST   /api/boards/:board/archive                read-only from here on
POST   /api/boards/:board/agents                 register
GET    /api/boards/:board/agents                 roster
GET    /api/boards/:board/cards?status=&assignee=
POST   /api/boards/:board/cards
GET    /api/boards/:board/cards/:id
POST   /api/boards/:board/cards/:id/claim
POST   /api/boards/:board/cards/:id/progress
POST   /api/boards/:board/cards/:id/move
POST   /api/boards/:board/cards/:id/complete
POST   /api/boards/:board/cards/:id/release
POST   /api/boards/:board/messages
GET    /api/boards/:board/events?since=<ulid>
GET    /api/boards/:board/events/stream          SSE tail of that board's log
```

`:board` accepts either the slug or the ULID.

MCP tools and REST handlers call one shared service module — no logic duplication. A shared bearer token via `Authorization` header on both surfaces.

---

## 7. Claude Code integration

### Connecting sessions

Project-scoped `.mcp.json` committed to the repo so every session in the project automatically gets the server:

```json
{
  "mcpServers": {
    "board": {
      "type": "http",
      "url": "http://localhost:8787/mcp?board=egg-hunt",
      "headers": { "Authorization": "Bearer ${BOARD_TOKEN}" }
    }
  }
}
```

The `board` query param pins every session in this repo to its board; other repos point at the same daemon with their own slug.

### The worker protocol (goes in CLAUDE.md)

A short, imperative section every session reads:

1. On start: `register_agent` with your role name. Note your `agent_id`.
2. Loop: `claim_next_card`. If nothing is eligible, `check_messages`, then `get_team_status`; if truly idle, say so and stop.
3. Work only within the card's `fileScope`, on the card's branch (`card/<id-short>` worktree).
4. Post `update_card_progress` after each meaningful subtask, and `check_messages` at the same checkpoints. Reply to messages before continuing.
5. If another card's outcome affects you (interface change, shared contract), `send_message` the holder — found via `get_team_status` — before assuming anything.
6. Finish with `complete_card` including a result summary and branch name. Then return to step 2.

This pull-based checkpoint polling is the awareness mechanism. It's deliberately boring: no push channel into a session's context exists, so the protocol makes polling a habit tied to actions the agent already performs.

### Hooks (enforcement, not hope)

- `SessionStart` → shell script calls REST `register` (or verifies registration) and injects current team status into context.
- `Stop` / `SessionEnd` → REST call marking the agent `offline` and releasing any held card with reason "session ended".
- `PostToolUse` (matcher on Edit/Write) → lightweight heartbeat, and optionally a guard that warns when an edited path falls outside the current card's `fileScope`.
- `UserPromptSubmit` → optional: inject unread-message count so mid-conversation sessions get nudged.

Hooks make the lifecycle correct even when the model forgets the protocol; CLAUDE.md makes the model cooperative in between.

### Worktrees

One git worktree per active card, named by branch convention. The orchestrator (or the agent itself, per CLAUDE.md) creates `../wt/card-<id-short>` on claim. `fileScope` prevents logical conflicts; worktrees prevent physical ones. Merging is a human (or reviewer-card) step in v1.

### Headless workers

The orchestration layer can spawn workers without terminals:

```
claude -p "You are backend-worker-1. Follow the worker protocol in CLAUDE.md." \
  --allowedTools "mcp__board__*,Edit,Write,Bash(git *)" \
  --output-format stream-json
```

A tiny Deno supervisor script can watch `GET /api/boards/:board/cards?status=ready` across boards, spawn N headless workers per board when a queue is deep, and let them die when they report idle. This is the seed of the visual orchestrator later — same APIs, plus rendering.

### Relationship to native agent teams

Native agent teams give a lead, shared task list, and inter-agent messaging out of the box, but they're experimental, single-team-per-session, and don't isolate teammates in worktrees. This board reimplements those primitives in an inspectable, persistent, cross-invocation form you fully control — sessions can join and leave across days, and the state survives every one of them. Keep the tool names conceptually parallel (task list, messaging, idle signaling) so migrating work between the two models stays easy.

---

## 8. Build order

**M1 — Core store (day 1-2).** KV schema, board create/list with atomic slug uniqueness, service module with card CRUD, atomic claim, indexes, event append — everything board-scoped from day one. `deno test` suite including a race test (20 concurrent `claim_next_card` calls against 5 ready cards must yield exactly 5 winners and clean indexes) and an isolation test (identical operations on two boards never touch each other's keys or events).

**M2 — Agents and liveness (day 2-3).** Registration, heartbeats, reaper, lease expiry and reclamation. Test: kill a fake worker mid-claim, assert the card returns to `ready` after lease expiry with the right event.

**M3 — MCP surface (day 3-5).** Streamable HTTP endpoint on Hono, all tools wired to the service layer. Verify with MCP Inspector, then a single real Claude Code session: register, claim, progress, complete a toy card end-to-end.

**M4 — Messaging and events (day 5-6).** Inbox, broadcast, cursors, `watch_events`, REST SSE tail. Test two concurrent sessions exchanging a message about a shared interface.

**M5 — Protocol pilot (week 2).** CLAUDE.md protocol section, hooks, worktree convention. Run 2-3 sessions on a real small feature split (e.g. API endpoint + consumer + tests as three dependent cards). Observe where the protocol breaks; tighten tool responses.

**M6 — Hardening.** Lease/heartbeat tuning, fileScope glob matching edge cases, dependency-cycle detection on `create_card`, event log compaction (retain last N days), token-cost audit of tool outputs.

---

## 9. Risks and open questions

- **Token overhead.** Polling team status and events costs context in every session. Mitigate with terse tool outputs and the `heartbeat` counts-only ping; measure in M5.
- **Protocol drift.** Models sometimes skip checkpoints. Hooks cover lifecycle events; consider a lead-role card whose job is periodically auditing the event log.
- **Message latency.** Pull-based delivery means a deeply focused session may not see a message for minutes. Acceptable for coordination, not for emergencies — the human stays the interrupt channel.
- **Tenancy.** One shared bearer token means any session can touch any board — fine for a solo machine, and board resolution keeps accidents unlikely. If the daemon ever leaves localhost, move to per-board tokens and enforce archive as a hard write gate.
- **When not to use it.** Sequential work, same-file edits, or heavily interdependent tasks are still better in one session; more agents means more coordination overhead, not automatically more speed. The board should make that visible (queue depth vs. active agents), not hide it.

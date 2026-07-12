# Switchboard

This repo holds two complementary multi-agent subsystems sharing one Deno + Hono backend:

- **Switchboard** — a desktop UI for supervising multiple Claude agent sessions at once: spawning them independently or as teams, watching a live activity feed, and approving or denying tool calls as they come in. Every session is a live `claude` CLI process driven through the **Claude Agent SDK**, working inside its own **git worktree** (optional per spawn) so concurrent agents never step on each other's uncommitted changes.
- **The Agent Kanban orchestration server** (`server/orchestration/`) — a headless, persistent, multi-board Kanban store with an MCP surface, letting any number of Claude Code sessions coordinate through cards, dependencies, leases, messages, and events — across restarts, days, and repos. See [its section below](#agent-kanban-orchestration-server-serverorchestration).

Switchboard recreates the UI/UX described in `design_handoff_switchboard/README.md`.

## Quickstart

### Prerequisites

- [Deno](https://deno.com/) (recent stable — `deno.json` uses `nodeModulesDir: "auto"` and the `deno desktop` subcommand)
- [`git`](https://git-scm.com/) on your `PATH` — sessions run inside a `git worktree` by default (opt-out per spawn)
- The `claude` CLI on your `PATH`, logged in via `claude login` — or an Anthropic API key with billing enabled ([console.anthropic.com](https://console.anthropic.com)), either works (see step 2)

### 1. Install dependencies

```bash
deno install
```

This also pulls in the `@anthropic-ai/claude-agent-sdk` npm package, which drives a local `claude` CLI subprocess per session.

### 2. Authenticate

If you've already run `claude login` on this machine, you're done — Switchboard's subprocess sessions inherit that login automatically. Otherwise, create `.env.local` in the project root (already gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Every command below that talks to Anthropic needs this sourced first (skip this if you're using `claude login`):

```bash
set -a; source .env.local; set +a
```

### 3. Build and run

```bash
deno task dev
```

This builds the Vite frontend into `dist/` and launches the app in a native webview (`deno desktop`) with HMR. The app starts with **zero sessions** — nothing is seeded. Every session that appears is one you spawned, and each one is a real, running `claude` CLI process the moment you create it, working inside its own git worktree.

To package a distributable build instead of running the dev webview: `deno task build:macos` / `build:windows` / `build:linux`.

### Running headless (no webview)

The backend is a plain Hono app (`main.ts`) served via `Deno.serve`, so it can run standalone for scripting or verification without the desktop shell:

```bash
set -a; source .env.local; set +a
deno run -A main.ts
```

This serves the API at `/api/switchboard/*`, the orchestration server at `/api/orchestration/*`, and the built frontend as static files, on `http://localhost:8000`.

## Architecture

```
┌─────────────────────┐      SSE (/events)       ┌──────────────────────┐
│  Preact frontend      │◀────────────────────────│  Hono backend          │
│  src/switchboard/      │      REST (POST)  ────▶ │  server/switchboard/    │
└─────────────────────┘                          └──────────┬───────────┘
                                                              │
                                                   Claude Agent SDK (query())
                                                              │
                                                              ▼
                                                   local `claude` CLI subprocess
                                                   cwd = a dedicated git worktree
```

### Frontend (`src/switchboard/`)

- **Preact + `@preact/signals`**, no router — a single-page app with tab-based navigation (Feed / Sessions / Teams) driven by signals in `store.ts`.
- `api.ts` is the only module that talks to the network: it fetches the initial snapshot (`GET /snapshot`) and then subscribes to a single `EventSource` (`GET /events`) for all subsequent state changes. There is no polling.
- `actions.ts` is the only module components call into — it wraps every network call and local UI-state transition (opening modals, toasts, keyboard nav) behind named functions, so components never import `api.ts` directly.
- Components are grouped by surface: `FeedView`/`EventCard`/`PinnedCard` (the activity feed and pinned decisions needing your attention), `SessionsTab`/`SessionPane`/`TeamMemberRow` (per-session detail and controls), `TeamsTab`, `SpawnModal`, `ReviewModal`, `GrantsPopover`.

### Backend (`server/switchboard/`)

- `state.ts` holds all server-side state in memory (sessions, teams, events, grants, transcripts) — there is no database. Restarting the process clears all state (each session's underlying `claude` CLI process also dies with the parent — see Shortcomings). Two deliberate exceptions persist to disk in the app-data dir: scheduled sessions (`schedule-store.ts` → `schedules.json`, with an opt-in "catch up on missed schedules at startup" setting in `settings-store.ts`) — a schedule is just data describing something to do later, so it shouldn't require the app to have stayed open.
- `bus.ts` is a minimal pub/sub used to fan out every state mutation over SSE to all connected frontend clients.
- `mutations.ts` is the **only** place allowed to write to `state` — every action module calls through it (`pushSessionPatch`, `pushFeedEvent`, `pushTranscriptMessage`, etc.), and each mutation automatically publishes to the bus. This is the seam that's kept every backend swap (simulated → Managed Agents → Claude Agent SDK) a contained change: nothing above `mutations.ts` has ever had to change.
- `routes.ts` wires HTTP verbs to action-module functions and exposes the SSE stream. Action modules (`spawn-actions.ts`, `session-actions.ts`, `resolutions.ts`, `team-actions.ts`, `grant-actions.ts`, `review-actions.ts`, `undo.ts`) contain the actual logic per feature area.

### Git worktrees

Every team is anchored to a **directory** (an existing git repo) and a **base ref**, both set at creation time. Every session in that team — and every independent/solo session, which picks its own directory + base ref at spawn time — gets its own worktree:

- `git-worktree.ts` creates each worktree as a sibling of the target repo (`<repo>-worktrees/<slug>-<sessionId>/`, never inside the repo itself) on a new branch named `switchboard/<slug>-<sessionId>`, branched from the base ref.
- The Agent SDK session's `cwd` is pointed at that worktree, so concurrent agents — even multiple members of the same team, working in the same repo — never share a working directory or clobber each other's uncommitted changes.
- When a session stops, its worktree is automatically removed (`removeWorktree`) — but the branch is **never** deleted. If anything was left uncommitted, it's committed first (`WIP: auto-saved by Switchboard before worktree removal`) so cleanup can never silently discard work. `git branch --list 'switchboard/*'` finds every branch Switchboard has created.

### The Claude Agent SDK integration

- `agent-sessions.ts` — `spawnAgentSession()` calls `query()` from `@anthropic-ai/claude-agent-sdk` with `cwd` set to the session's worktree and a streaming (`AsyncIterable`) prompt, so later messages (chat replies, retries, resume's "Continue.") can be pushed into the same running session without starting a new `query()` call. It translates the resulting `SDKMessage` stream (`assistant` text/tool-use, `user` tool-result echoes, `system`/`session_state_changed` running↔idle transitions, `result` cost/error info) into the same `mutations.ts` calls used everywhere else in the backend.
- `agent-registry.ts` — an in-memory map from Switchboard's session ids to the live `Query` object (plus a way to push follow-up messages and a "allow for rest of session" flag), and a map of pending tool-call approvals waiting on a human decision.
- Tool-call approvals stay in the existing feed UI: `canUseTool` (passed into `query()`'s options) pushes an `approval` feed event and returns a Promise that only resolves once `resolutions.ts`'s `approveEvent`/`denyEvent` resolves it — the same approve/deny UX the app has always had, just backed by a local callback instead of a remote confirmation API call.

**Key design decision:** every Switchboard session — whether spawned solo or as part of a team — maps to exactly one local `query()` process in its own worktree. "Team" stays a purely local grouping concept (`state.teams`, holding the shared `dir`/`baseRef`, plus a `teamId`/`lead` field on each session).

Teams support three coordination modes (`spawn-actions.ts`): **plain** (all members spawn at once, coordination limited to kickoff task text), **sequenced** (only the lead spawns; it writes a `SWITCHBOARD_TASKS.md` spec — parsed by `team-spec.ts` — and workers are then spawned from it, branching off the lead's branch), and **autonomous** (the lead gets a `spawn_worker` SDK tool and decides itself when to bring on workers).

### Data flow for a spawn

1. Frontend `POST /api/switchboard/sessions` (with `dir`/`baseRef` for solo/new-team spawns) → `spawn-actions.ts`.
2. A local `Session` record is created and pushed to the frontend immediately (`pushSessionAdd`, `statusLine: "Creating worktree…"`) so the UI feels instant.
3. The repo/ref are validated, the worktree is created, then `spawnAgentSession()` fires: `query()` starts the local `claude` process with `cwd` in that worktree and sends the kickoff task as the first queued message.
4. Every message the real agent produces (thinking out loud, running a command, asking for approval, finishing a turn) streams back and is translated into `mutations.ts` calls — indistinguishable, from the frontend's point of view, from any other state change. Any failure in steps 2-3 patches the session to `status: "error"` with a feed event instead.

## Agent Kanban orchestration server (`server/orchestration/`)

Where Switchboard supervises sessions it spawned itself, the orchestration server coordinates sessions **it didn't spawn and doesn't own**: a headless, multi-board Kanban store that any Claude Code session can join, claim work from, and report back to. Sessions come and go across restarts and days; the board is the durable thing. Full design, data model, and build order: `agent-kanban-orchestration-plan-v2-1.md` — all six milestones (M1–M6) are implemented, including a live pilot in which headless workers completed a real three-card dependent feature split end-to-end.

- **Storage** is Deno KV at `<app-data>/orchestration/kv.db` — unlike Switchboard's in-memory sessions, board state survives restarts by design. Every mutation is a single `kv.atomic()` with versionstamp checks: record + secondary indexes + event append, never a partial write (`service.ts` is the one place coordination rules live; REST and MCP are both thin wrappers over it).
- **Coordination semantics**: cards carry priority, `dependsOn` (gating: a card stays in `backlog` until every dependency is `done`), `fileScope` (segment-aware glob overlap detection prevents two in-progress cards from touching the same files), and acceptance criteria. Claims are atomic — 20 concurrent `claim_next_card` calls against 5 ready cards yield exactly 5 winners (tested). Claims hold a 10-minute lease renewed by heartbeats and progress updates; a reaper marks silent agents offline (proof of life revives them), reclaims expired leases back to `ready`, and compacts events past a retention window (7 days default).
- **REST** under `/api/orchestration`: boards, cards, `claim`/`claim-next`, `progress`/`move`/`complete`/`release`, agents + heartbeats, messages, events, and an SSE tail at `/boards/:board/events/stream`. Optional shared bearer token via `ORCHESTRATION_TOKEN` (off by default for local dev).
- **MCP** (Streamable HTTP) at `/api/orchestration/mcp?board=<slug>`: 18 tools (`register_agent`, `claim_next_card`, `update_card_progress`, `complete_card`, `send_message`, `check_messages`, `watch_events`, `get_team_status`, …), plus board-snapshot/card resources and a worker-briefing prompt. Tool outputs are deliberately terse — token cost is real when several sessions poll.
- **Claude Code integration**: this repo's `.mcp.json` pins every session here to the `ai-multiagents` board. `CLAUDE.md`'s "Board worker protocol" section tells worker sessions how to behave (claim → work in a `card/<id-short>` worktree → progress + messages at checkpoints → complete); lifecycle hooks (`tools/board-hook.ts`, wired in `.claude/settings.json`, active only when `AGENT_BOARD` is set) enforce registration, heartbeats, fileScope drift warnings, and release-on-exit even when the model forgets. `tools/spawn-worker.sh <name> [role] [board]` launches a headless worker.
- **Relationship to Switchboard teams**: teams coordinate sessions one parent process spawned; the board coordinates sessions nobody owns. The tool vocabulary is kept conceptually parallel (task list, messaging, idle signaling) so work can migrate between the two models.

## Shortcomings

These are known, deliberate gaps — not oversights — made explicit rather than faked:

- **Sessions die with the backend process.** Each session is a local `claude` CLI subprocess of the Switchboard server; restarting the backend kills every running session (unlike the old Managed Agents integration, where remote sessions outlived a restart). The Agent SDK's `resume`/`sessionId` options could reconnect to a still-alive session's on-disk transcript, but that's not wired up yet.
- **Stop has no undo.** Stopping a session interrupts and closes its `claude` process and removes its worktree — genuinely irreversible (though the branch, and its commits, always survive) — unlike deny/approve/revoke, which do have a short undo grace window, Stop deliberately does not, to avoid showing an "Undo" link that would lie.
- **Pause/Resume is an approximation.** There's no true suspend/resume primitive; Pause calls `query.interrupt()` and Resume pushes a follow-up "Continue." message rather than truly suspending and resuming mid-turn.
- **Retry/alt-fix are just follow-up messages,** not a structured retry API — there's no primitive for "redo the last tool call with different arguments."
- **No artifact review implementation.** The review modal UI exists but has nothing to open — there's no output-file/review-gate concept wired up from the CLI's file writes yet.
- **Teams share no live context.** Sequenced/autonomous modes give a lead real control over *when and with what task* workers spawn, but teammates still don't see each other's transcripts — coordination flows through the task spec, git history, or (opt-in) the orchestration board, not shared memory.
- **No milestone/progress tracking.** `msDone`/`msTotal` are static placeholders (`msTotal: 4`, never incremented).
- **Live processes don't survive a restart.** All state (sessions, teams, feed, transcripts, grants, MCP configs) now persists to `state.json` and is restored on launch — but each session's `claude` subprocess dies with the app, so previously-running sessions come back as `stopped` with their history intact and an explanatory transcript note, not as live processes. Reconnecting them via the SDK's `resume` option is the remaining gap.
- **Effort changes aren't possible mid-session.** Model changes are wired up via `Query.setModel()`, but the Agent SDK has no equivalent for effort.

## Next steps

Roughly in priority order:

1. **Live session resume** — state now survives restarts (`state-store.ts`); the remaining piece is capturing each session's SDK session id and reconnecting via `query({ options: { resume } })` on launch, so a restart continues sessions instead of restoring them as stopped.
2. **Board UI in Switchboard** — the orchestration server is headless; render boards, cards, agents, and the event stream in the desktop app (same APIs, plus rendering). The plan calls the queue-watching supervisor script "the seed of the visual orchestrator."
3. **Claim fairness on the board** — a fast worker can drain the whole ready queue before a slower-starting one boots; a max-cards-per-agent or round-robin knob would keep multi-worker runs genuinely parallel.
4. **Configurable agent setup** — let a spawn specify a different system prompt or tool restriction instead of always using the one shared `WORKER_SYSTEM_PROMPT`.
5. **Artifact review** — investigate watching the worktree for file changes (or diffing against the base ref) to reconstruct the review-gate flow.
6. **Milestone tracking** — derive `msDone`/`msTotal` from some structured signal (e.g. counting `assistant` text messages, or tool-call milestones) instead of leaving them static.
7. **Multi-user / remote access** — the app currently assumes one local user; there's no auth layer beyond the orchestration server's opt-in bearer token if this were ever exposed beyond localhost.

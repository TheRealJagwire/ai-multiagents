# Switchboard

Switchboard is a desktop UI for supervising multiple Claude agent sessions at once — spawning them independently or as teams, watching a live activity feed, and approving or denying tool calls as they come in. It's a Deno + Hono backend paired with a Preact frontend, and it runs real work through the **Claude Agent SDK**: every session in the app is a live `claude` CLI process running locally, each one working inside its own **git worktree** so multiple agents can operate on the same repo concurrently without stepping on each other's uncommitted changes.

This recreates the UI/UX described in `design_handoff_switchboard/README.md`.

## Quickstart

### Prerequisites

- [Deno](https://deno.com/) (recent stable — `deno.json` uses `nodeModulesDir: "auto"` and the `deno desktop` subcommand)
- [`git`](https://git-scm.com/) on your `PATH` — every session runs inside a `git worktree`
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

This serves the API at `/api/switchboard/*` and the built frontend as static files, on `http://localhost:8000`.

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

- `state.ts` holds all server-side state in memory (sessions, teams, events, grants, transcripts) — there is no database. Restarting the process clears all state (each session's underlying `claude` CLI process also dies with the parent — see Shortcomings).
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

**Key design decision:** every Switchboard session — whether spawned solo or as part of a team — maps to exactly one local `query()` process in its own worktree. "Team" stays a purely local grouping concept (`state.teams`, holding the shared `dir`/`baseRef`, plus a `teamId`/`lead` field on each session) — there's no cross-process coordination beyond what's stated in each member's kickoff task text (see Shortcomings).

### Data flow for a spawn

1. Frontend `POST /api/switchboard/sessions` (with `dir`/`baseRef` for solo/new-team spawns) → `spawn-actions.ts`.
2. A local `Session` record is created and pushed to the frontend immediately (`pushSessionAdd`, `statusLine: "Creating worktree…"`) so the UI feels instant.
3. The repo/ref are validated, the worktree is created, then `spawnAgentSession()` fires: `query()` starts the local `claude` process with `cwd` in that worktree and sends the kickoff task as the first queued message.
4. Every message the real agent produces (thinking out loud, running a command, asking for approval, finishing a turn) streams back and is translated into `mutations.ts` calls — indistinguishable, from the frontend's point of view, from any other state change. Any failure in steps 2-3 patches the session to `status: "error"` with a feed event instead.

## Shortcomings

These are known, deliberate gaps — not oversights — made explicit rather than faked:

- **Sessions die with the backend process.** Each session is a local `claude` CLI subprocess of the Switchboard server; restarting the backend kills every running session (unlike the old Managed Agents integration, where remote sessions outlived a restart). The Agent SDK's `resume`/`sessionId` options could reconnect to a still-alive session's on-disk transcript, but that's not wired up yet.
- **Stop has no undo.** Stopping a session interrupts and closes its `claude` process and removes its worktree — genuinely irreversible (though the branch, and its commits, always survive) — unlike deny/approve/revoke, which do have a short undo grace window, Stop deliberately does not, to avoid showing an "Undo" link that would lie.
- **Pause/Resume is an approximation.** There's no true suspend/resume primitive; Pause calls `query.interrupt()` and Resume pushes a follow-up "Continue." message rather than truly suspending and resuming mid-turn.
- **Retry/alt-fix are just follow-up messages,** not a structured retry API — there's no primitive for "redo the last tool call with different arguments."
- **No artifact review implementation.** The review modal UI exists but has nothing to open — there's no output-file/review-gate concept wired up from the CLI's file writes yet.
- **Teams have no real cross-agent awareness.** Because each session is an independent local process, a team "worker" doesn't automatically see its "lead"'s context — coordination is limited to what's stated in each member's kickoff task text (and whatever they can see of each other's commits in the shared repo's git history).
- **No milestone/progress tracking.** `msDone`/`msTotal` are static placeholders (`msTotal: 4`, never incremented).
- **No persistence.** All Switchboard state is in-memory; restarting the backend loses the local session list.
- **No cost tracking yet.** The `cost` field on sessions is always `0`, even though `SDKResultMessage.total_cost_usd` is right there in the message stream — this is cheap to wire up (see Next steps).
- **Model/effort changes aren't wired up.** `Query.setModel()` makes mid-session model changes technically possible (effort has no equivalent SDK method), but the step-boundary "queue a change" UI from earlier phases isn't connected to it yet.

## Next steps

Roughly in priority order:

1. **Cost tracking** — `SDKResultMessage.total_cost_usd` is already in the message stream `agent-sessions.ts` consumes; wire it into `cost` instead of leaving it at 0. Lowest-effort item on this list.
2. **Mid-session model changes** — `Query.setModel()` exists; connect the existing "queue a model change at next step boundary" UI to it instead of leaving it inert.
3. **Persistence** — move `state.ts` off in-memory storage (SQLite would be a natural fit for a single-user desktop app), and use the SDK's `resume`/`sessionId` options to reconnect to still-running sessions after a backend restart instead of losing them.
4. **Configurable agent setup** — let a spawn specify a different system prompt or tool restriction instead of always using the one shared `WORKER_SYSTEM_PROMPT`.
5. **Artifact review** — investigate watching the worktree for file changes (or diffing against the base ref) to reconstruct the review-gate flow.
6. **Real team coordination** — evaluate a lightweight shared-context mechanism (e.g. a scratch file in the repo, or relaying a lead's messages to workers) as an opt-in mode for teams that need more than kickoff-task-text coordination.
7. **Milestone tracking** — derive `msDone`/`msTotal` from some structured signal (e.g. counting `assistant` text messages, or tool-call milestones) instead of leaving them static.
8. **Multi-user / remote access** — the app currently assumes one local user; there's no auth layer if this were ever exposed beyond localhost.

# ai-multiagents

Deno desktop app: Switchboard (agent-session supervisor UI, `src/` + `server/switchboard/`) plus a headless orchestration server (`server/orchestration/`) — a multi-board Kanban store with an MCP surface for coordinating multiple Claude Code sessions. Architecture: `README.md`. Orchestration design + build order: `agent-kanban-orchestration-plan-v2-1.md` (all milestones M1–M6 implemented).

Run the server: `deno task build` once (frontend), then `deno run -A main.ts` → `http://localhost:8000` (`deno.json` already enables unstable KV). Orchestration REST lives under `/api/orchestration`, the MCP endpoint at `/api/orchestration/mcp?board=<slug>` (this repo's board slug: `ai-multiagents`, wired in `.mcp.json` as server name `board`). Tests: `deno test -A server/`.

## Board worker protocol

This section applies **only** if your starting prompt names you a board worker (e.g. "You are backend-worker-1 …"). In an ordinary dev session, ignore it entirely.

1. On start: call `register_agent` (on the `board` MCP server) with your assigned name and role. Note the returned `agent_id` — every later call needs it. Registration is an upsert by name, so re-registering after a restart reclaims your identity.
2. Loop: `claim_next_card`. If nothing is eligible, read the near-miss reasons in the response, then `check_messages`, then `get_team_status`; if truly idle, say so and stop.
3. Work only within the claimed card's `fileScope`, in that card's own worktree and branch (see Worktree convention below). Never edit outside your `fileScope` — if the work genuinely requires it, `send_message` the card's creator or holder, or `release_card` with a reason.
4. After each meaningful subtask: `update_card_progress` with a one-line note, and `check_messages` at the same checkpoint. Reply to messages before continuing work.
5. If your work changes something another card depends on (an interface, a shared contract), find the holder via `get_team_status` and `send_message` them **before** assuming anything.
6. Finish with `complete_card`, including a result summary and your branch name. Then return to step 2.

Leases expire (default 10 min) if you neither heartbeat nor post progress — the card silently returns to `ready` for someone else. Progress updates and heartbeats renew it; the session hooks in `.claude/settings.json` also heartbeat for you on every file edit.

### Worktree convention

One git worktree per active card, so parallel workers never touch the same checkout. On claim, from the repo root:

```
git worktree add ../wt/card-<id-short> -b card/<id-short>
```

where `<id-short>` is the **last 6 characters of the card id, lowercased** (card ids are ULIDs; the tail is the high-entropy part). Do all work and commits there. Pass `card/<id-short>` as the `branch` argument to `complete_card`. Do **not** merge — merging is a human (or reviewer-card) step in v1. After completing, remove the worktree: `git worktree remove ../wt/card-<id-short>`.

# Automated-testing gap analysis and plan

_Written 2026-07-12. Test style: Deno BDD (`describe`/`it` from `jsr:@std/testing/bdd`), in-memory `Deno.openKv(":memory:")` where KV is involved, real temp dirs where the filesystem is involved. Run everything with `deno task test`._

## What's covered today

One test file: `server/orchestration/service.test.ts` — 24 tests over the orchestration **service layer** (boards, cards/dependencies, atomic claiming, fileScope overlap, reaper/leases, messaging, event cursors, M6 hardening). This is the right file to have first: it holds every coordination rule, and both REST and MCP are thin wrappers over it. Everything else in the repo is untested.

## Gaps, prioritized

### P1 — switchboard server modules with real logic and zero tests

The persistence layer added recently is exactly the kind of code that fails silently months later.

1. **`state-store.ts`** — round-trip persist/restore; previously-running sessions sanitized to `stopped` with the one-time transcript note (and no duplicate note on double restart); id-counter restore (no `e-42` collisions); corrupt/missing `state.json` degrades to empty instead of failing startup; event/transcript caps applied on write.
2. **`settings-store.ts`** — `updateSettings` merges partials and deletes `undefined` keys (the catch-up-toggle-wipes-api-key regression, now fixed, deserves a pinned test); write chain serializes concurrent updates; malformed file → defaults.
3. **`schedule-actions.ts` (pure parts)** — `reconcileMissedSchedule` / `advancePastNow`: missed one-shot → `skipped` vs fired under catch-up; recurring advances past now (interval and weekly, including DST-adjacent local times).
4. **`team-spec.ts`** — already pure: heading parsing, empty sections, no-headings input, whitespace.
5. **`api-key-actions.ts`** — validation (`sk-ant-` shape), env set/cleared, status fields updated; needs a small seam or env assertion via `Deno.env.get`.

These are all directly testable today — no server needed. Estimated one sitting each.

### P2 — orchestration HTTP surfaces (REST + MCP)

The service layer is tested, but the wrappers can still drift (wrong status codes, auth, board resolution, output slimming):

6. **`routes.ts`** — spin up the Hono app in-process (`orchestrationApp.request(...)`, no port needed): bearer-token gate when `ORCHESTRATION_TOKEN` set; 404 unknown board; 400 unknown dependsOn (the M5-pilot behavior); 409 claim conflicts; SSE endpoint shape (first event id).
7. **`mcp.ts`** — board resolution precedence (explicit arg > agent binding > `?board=` query); `stripBoardId` recursion; `slimAgent` field set; error results carry `isError: true`. The pure helpers can be exported-for-test or exercised via `mcpFetch` with JSON-RPC requests.

### P3 — mutation/bus seam and the worker hook

8. **`mutations.ts` + `bus.ts`** — each mutation publishes the right topic with the right payload and touches `state` correctly; `persistStateSoon` debounce coalesces a burst into one write (fake timers from `jsr:@std/testing/time`).
9. **`tools/board-hook.ts`** — currently exits on missing `AGENT_BOARD` and is fetch-driven; refactor its four handlers to take an injected `fetch` (or base URL pointing at an in-process Hono app) so session-start/post-tool-use (fileScope warning)/session-end (release-then-offline ordering) become unit-testable. Today it's only verified manually.

### P4 — frontend logic (worth it only for the pure parts)

10. **`src/switchboard/store.ts` computeds** — `filteredStream` (kind filter × unread × session × search interplay), `railGroups`, `spawnValidationError`. These are pure signal computations; they run under plain `deno test` with a DOM-free import if the `localStorage` reads at module top are guarded (small refactor: lazy-init or `globalThis.localStorage?` fallback).
11. **Component rendering** is deliberately out of scope for now — it would pull in a DOM shim and preact test renderer for comparatively little risk. Revisit if a rendering regression actually bites.

### Infrastructure

- `deno task test` added (runs `server/`). Extend to `tools/` when #9 lands.
- No CI exists; when the repo gets a remote pipeline, the task is the entry point.
- Keep the convention: tests live next to the module (`x.test.ts`), BDD style, one `describe` per domain concept.

## Suggested order

P1.1–P1.2 first (persistence — highest silent-failure risk, and both had real bugs this week), then P1.3–P1.5, then P2 as one unit ("HTTP contracts"), then P3, then P4.10 opportunistically.

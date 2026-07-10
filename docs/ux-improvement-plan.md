# Switchboard UX Improvement Plan

Written 2026-07-09 by a Claude Code session doing a UX audit of the frontend
(`src/switchboard/`). Coverage: every component in
`src/switchboard/components/` plus `App.tsx`, `store.ts`, `actions.ts`,
`api.ts` has been reviewed — the audit is complete; findings below are the
full set. This is a plan for a **future session to implement** —
each item lists the weakness, the fix, and the files involved. Items are
ordered by impact. Open questions for the user are collected at the bottom
and inline as **[Q?]** markers.

Ground rules for the implementing session:

- Work through phases in order; each phase is independently shippable.
- Don't fake anything — this codebase's philosophy (see README "Shortcomings")
  is that honest gaps beat simulated features. Fixes below either wire up real
  behavior or remove/label the dishonest UI.
- After each phase, run the app (`deno task dev`) and exercise the changed flow.

---

## Phase 1 — Trust: stop the UI from lying (highest impact)

The app currently shows several elements that look functional but are inert or
wrong. For a supervision tool whose whole job is "trust what the dashboard
tells you," these are the worst UX bugs.

### 1.1 Cost always shows $0.00
- **Weakness:** `session.cost` is never updated; the pane shows a real-looking
  `$0.00` forever. README lists this as the #1 next step.
- **Fix:** In `server/switchboard/agent-sessions.ts`, on `SDKResultMessage`
  read `total_cost_usd` and accumulate into the session via
  `mutations.ts` (`pushSessionPatch`). Frontend already renders it
  (`formatCost` in `SessionPane.tsx:122`).

### 1.2 Milestone/progress bar is static (0/4 forever)
- **Weakness:** `SessionPane.tsx:206-224` renders a 4-segment progress bar from
  `msDone`/`msTotal`, which are hardcoded placeholders. A progress bar that
  never moves reads as "stuck" and erodes trust in every other indicator.
  The same bar is duplicated on every card in `SessionsTab.tsx:50-62` —
  remove/replace it in both places.
- **Fix (short term):** Remove the bar and show only `phaseLabel · elapsed`.
  A wrong progress bar is worse than none.
- **Fix (longer term, optional):** Derive progress from turn count or
  tool-call milestones. **[Q1]** — see questions.

### 1.3 Inert model/effort chips in the session pane
- **Weakness:** `SessionPane.tsx:143-166` renders model/effort chips with
  `cursor: not-allowed` — they look like controls but do nothing, while
  `queueModelChange`/`queueEffortChange` actions already exist in
  `actions.ts:327-347` and the pending-change UI renders right below.
- **Fix:** Make the chips call `queueModelChange`/`queueEffortChange`
  (the queue/pending/cancel plumbing is already there), and wire the backend
  to `Query.setModel()` at the next step boundary (README next-step #2).
  Effort has no SDK method — keep effort chips disabled but add a tooltip
  ("Effort can't change mid-session") so disabled state is explained, or hide
  them post-spawn.

### 1.4 Permanently disabled "Hand off" button
- **Weakness:** `SessionPane.tsx:259-273` — a dead button with no explanation.
- **Fix:** Remove it, or replace with the existing move-to-team flow
  (`queueMove`) if that's what it was meant to be. **[Q2]**

### 1.5 Optimistic toasts report success before it happens
- **Weakness:** `actions.ts` `approveEvent`/`denyEvent`/`confirmStopSession`/
  `confirmDeleteSession` show "Approved X" / "Stopped X" toasts *before* the
  API call resolves; a failed call leaves the user believing it worked.
- **Fix:** `await` the API call; on rejection replace the toast with an error
  toast ("Couldn't approve — retry"). Keep the optimistic toast only where
  there's a real undo (approve/deny), but still swap to error on failure.

### 1.6 Top-bar status dot always pulses green
- **Weakness:** `TopBar.tsx:53-59` renders a pulsing green dot next to
  "N running · M need you" unconditionally — with 0 sessions running it still
  signals live activity. Same trust problem as the frozen progress bar, in
  the opposite direction.
- **Fix:** Dot color/animation from state: pulsing green only when
  `runningCount > 0`; amber when `needsYouCount > 0` (attention beats
  activity); static gray otherwise. Bonus: make "M need you" clickable —
  switch to the Feed tab and scroll to the pinned block.

## Phase 2 — Resilience: surface failures instead of silence

### 2.1 API errors are swallowed
- **Weakness:** `api.ts` never checks `res.ok` and callers don't catch.
  A failed spawn/approve/send silently does nothing visible (spawn errors do
  produce an error *session*, but direct action failures vanish).
- **Fix:** Add a small `request()` helper in `api.ts` that throws on non-2xx
  with the server's error text; in `actions.ts`, catch and `showToast` the
  message. One helper, applied to all POSTs.

### 2.2 SSE disconnect is invisible
- **Weakness:** If the backend restarts (which kills all sessions per README),
  the `EventSource` silently retries and the UI keeps showing stale
  running-sessions state. The user has no idea the dashboard is dead.
- **Fix:** Listen to `EventSource.onerror`/`onopen` in `api.ts`; expose a
  `connectionState` signal in `store.ts`; render a top-of-screen banner
  ("Connection lost — reconnecting…") and, on reconnect, re-fetch the snapshot
  (currently the snapshot is fetched exactly once at mount, so a reconnect
  resumes events on top of stale state).

### 2.3 Spawn modal has zero validation
- **Weakness:** `submitSpawn` (`actions.ts:483-522`) POSTs and closes the modal
  unconditionally: empty task, empty team name, blank directory, relative
  path — all "succeed" from the modal's perspective, and the user discovers
  the failure later as an error session (or not at all for a 400).
- **Fix:** Inline validation before submit: task/goal non-empty, directory
  non-empty + absolute (starts with `/`), team name non-empty in "new" mode.
  Disable the submit button with a reason, or show field-level error text.
  Keep the modal open until the POST succeeds; show the server's error inline
  on failure (pairs with 2.1).

### 2.4 Modal dismissal destroys typed work
- **Weakness:** Clicking the overlay background or pressing Escape closes the
  spawn modal and (on reopen) `openSpawnModal` resets every field — a long
  team goal typed out is silently lost on a stray click.
- **Fix (cheapest):** Don't reset fields on *close*; only reset on successful
  submit (move the reset out of `openSpawnModal` into `submitSpawn`, keeping a
  "mode changed" reset). A stray click then costs nothing.

## Phase 3 — Core interaction quality

### 3.1 Chat input can't hold multi-line messages
- **Weakness:** `SessionPane.tsx:566-586` uses a single-line `<input>`; Enter
  sends immediately. Pasting a multi-line instruction to an agent is
  impossible — a core action for this app.
- **Fix:** Swap to an auto-growing `<textarea>` (cap ~6 rows); Enter sends,
  Shift+Enter inserts a newline. Preserve per-session drafts: `chatText` is a
  single global signal today, so switching sessions wipes the draft — key it
  by session id. Apply the same input→textarea treatment to the review
  modal's "Optional note for the agent" field (`ReviewModal.tsx:120-133`).

### 3.2 Transcript auto-scroll yanks the user to the bottom
- **Weakness:** `SessionPane.tsx:54-57` pins scroll to bottom on every new
  message — scrolling up to read history is impossible while the agent is
  streaming.
- **Fix:** Only auto-scroll if the user was already within ~80px of the bottom
  before the update; otherwise show a "↓ New messages" pill that jumps down.

### 3.3 Transcript is raw text
- **Weakness:** Agent output renders as plain text — no markdown (agents emit
  headings/code fences constantly), and long tool commands render as one
  unwrappable monospace blob.
- **Fix:** Render `text`/`summary` messages through a small markdown renderer
  (e.g. `marked` + sanitize, or a minimal subset renderer to stay
  dependency-light — **[Q3]**). Truncate tool messages to ~4 lines with a
  click-to-expand.

### 3.4 Approval cards lack the context to decide safely
- **Weakness:** The permission card (both feed and transcript,
  `SessionPane.tsx:496-551`) shows only the command string. The human is asked
  to approve `rm -rf …` with no cwd, no session working-dir reminder, no
  "allow for session" option in the transcript variant (feed has scope
  options; transcript offers only Approve once / Deny — inconsistent).
- **Fix:** Show worktree path + session name on every approval card; add the
  same "Approve once / Allow for session / Deny" trio in the transcript
  variant, reusing `approveEvent(id, "session")`. Also: "Allow this pattern
  for session" (`PinnedCard.tsx:83-85`) never shows *which* pattern will be
  granted — the user only discovers it afterward in the grants popover.
  Surface the derived pattern on/under the button (small mono text) before
  the click.

### 3.5 Keyboard model is fragile and undiscoverable
- **Weakness:** `App.tsx:86-117` — j/k/y/n exist but nothing in the UI reveals
  them; `focusedPinnedIndex` is index-based, so when the pinned list changes
  (another agent's approval resolves), y/n can fire on a *different* card than
  the one visually focused; `y` can't grant session scope.
- **Weakness (worse than first noted):** `PinnedBlock.tsx:9` shows only the
  first 2 pinned cards unless "show all" is expanded, but `focusedPinnedIndex`
  ranges over the *full* list — j/k can move focus onto a collapsed,
  invisible card, and y/n then approves/denies something the user cannot see.
- **Fix:** Track focus by event *id*, not index; clamp/reset when the list
  changes; either auto-expand the pinned block when focus moves past the
  visible window or clamp focus to visible cards. Add a `?` shortcut + a
  small "j/k navigate · y approve · n deny" hint line at the bottom of the
  pinned block. Add `Y` (shift) for "allow for session".

### 3.6 Timestamps never tick
- **Weakness:** Nothing in the app updates the clock. `relativeTime(event.ts)`
  ("2m ago", `EventCard.tsx:57`) and `elapsed(startedAt)` (`SessionPane.tsx:222`,
  `TeamsTab.tsx:76`) call `Date.now()` at render time only — there is no
  interval or ticking signal anywhere (verified: zero `setInterval` in
  `src/switchboard/`). During a quiet stretch, "2m ago" and elapsed timers
  freeze until an unrelated SSE event happens to re-render, then jump.
- **Fix:** Add a `now` signal in `store.ts` updated by a single
  `setInterval` every 30s (started in `App.tsx`); pass `now.value` into
  `relativeTime`/`elapsed` (or read it inside them via import) so every
  consumer re-renders on tick. Cheap and fixes all frozen times at once.

## Phase 4 — First-run and polish

### 4.1 Empty state gives no path forward
- **Weakness:** Fresh app shows "Nothing here — you're all caught up."
  (`FeedView.tsx:39-43`) — accurate but a dead end; the user's next move
  (spawn something) is hidden in the top bar.
- **Fix:** When there are zero *sessions* (not just zero events), render an
  onboarding empty state: one-line explanation + "New session" / "New team"
  buttons calling `openSpawnModal`.

### 4.2 Directory input is hostile
- **Weakness:** Typing absolute repo paths from memory into a text field
  (`SpawnModal.tsx:175-181`) is the single highest-friction step in the spawn
  flow, and the #1 source of spawn errors validation (2.3) will catch.
- **Fix:** Remember recently used directories (localStorage) and offer them as
  one-click chips under the input. A native directory picker isn't reachable
  from the webview without backend help; a `GET /api/switchboard/dirs?prefix=`
  autocomplete endpoint is a nice follow-up. **[Q4]**

### 4.3 Accessibility basics
- **Weakness:** Interactive elements are mostly `<span onClick>` (chips, ✕
  buttons, "cancel"/"+ Add member" links) — unreachable by keyboard, invisible
  to screen readers; base font sizes run 9–12.5px.
- **Fix:** Sweep: clickable spans → `<button type="button">` with the existing
  styles (a shared unstyled-button class in `tokens.css` keeps this cheap);
  add `aria-label` to icon-only buttons; bump the smallest text one notch
  (9→10, 9.5→10.5) after visual check.

### 4.4 Hardcoded colors bypass the token system
- **Weakness:** A handful of literals undercut `tokens.css` and block any
  future theme work: unread-card background `#fffcf5` (`EventCard.tsx:38`,
  `EventRow.tsx:25`), active-tab background `#fff` (`TopBar.tsx:40`), `#fff`
  text on primary buttons throughout, `rgba(28,27,24,.28)` modal overlays
  (`SpawnModal.tsx`, `ReviewModal.tsx`, `McpConfigsModal.tsx`), and the
  pinned-card accent palette (`PinnedCard.tsx:9-13` — `#d98324`, `#ecd9b8`,
  `#c4432b`, …). `tokens.css` has no dark palette at all.
- **Fix:** Introduce `--sb-unread-bg`, `--sb-tab-active-bg`, `--sb-on-primary`,
  `--sb-overlay` tokens and replace the literals. Whether to then add an
  actual dark palette is **[Q6]**.

### 4.5 Left rail is blank on first run
- **Weakness:** With zero sessions the rail is an empty white column — pairs
  with the feed's dead-end empty state (4.1).
- **Fix:** Small muted hint in the rail ("Sessions appear here") or collapse
  the rail entirely until the first session exists; the feed empty state
  (4.1) carries the CTA.

### 4.6 MCP config management is inconsistent and unvalidated
- **Weakness:** In `McpConfigsModal.tsx`: (a) Delete removes a config
  instantly — no confirm, no undo — while sessions/teams both get a confirm
  step; (b) there's no way to edit a config (a typo means delete + retype
  everything); (c) the only validation is a non-empty name
  (`actions.ts:587`) — you can save an `http` server with no URL or a
  `stdio` server with no command.
- **Fix:** Reuse the existing ask/confirm pattern for delete; require
  command (stdio) or URL (http/sse) before enabling "+ Add server"; add an
  Edit affordance that pre-fills the form and replaces on save (backend
  route may need an update endpoint — check `routes.ts`).

### 4.7 Toast pile-up
- **Weakness:** Single toast slot with a fixed 7s timer (`actions.ts:182-190`);
  rapid approve/deny across sessions overwrites earlier toasts — and with them
  their undo affordances.
- **Fix:** Queue up to 3 stacked toasts; each keeps its own timer. Undo-bearing
  toasts should persist a bit longer than info toasts.

---

## Open questions — resolved 2026-07-09

- **[Q1] Progress bar:** **Remove it.** Show only `phaseLabel · elapsed` until
  there's a real signal to drive a bar.
- **[Q2] "Hand off" button:** **Remove it entirely** (not a repurpose of
  `queueMove` — that flow stays as its own UI).
- **[Q3] Markdown in transcripts:** **Add a small dependency** (`marked` +
  a sanitizer) rather than hand-rolling a renderer.
- **[Q4] Directory picking:** **Add a backend autocomplete endpoint**
  (`GET /api/switchboard/dirs?prefix=`) — touches `routes.ts` + a new action
  module, in addition to the frontend recent-dirs chips.
- **[Q6] Dark mode:** **Tokenize + add a real dark palette** — `prefers-color-scheme`
  support plus a manual toggle, not just tokenization.
- **[Q5] Priorities:** **Keep phase order as planned** (1 → 2 → 3 → 4,
  trust/honesty fixes first).

## Out of scope (already tracked in README "Next steps")

Persistence/session resume, artifact review, real team coordination,
multi-user auth. This plan deliberately targets only the UX layer of what
exists today.

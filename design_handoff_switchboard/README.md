# Handoff: Switchboard — Multi-Agent Orchestration Interface

## Overview

Switchboard is a desktop web app for orchestrating multiple AI agent sessions at once — both **independent sessions** and **teams** (a lead agent coordinating workers). The user's core loop:

1. **Monitor** a newsfeed of what all agents are doing
2. **Triage** decisions agents are waiting on (command approvals, error recovery, artifact reviews) — these are *pinned* and never scroll away
3. **Drill in** to any session via a split-pane transcript + chat
4. **Restructure** teams (move members, promote leads, change model/effort) with *step-boundary* semantics — changes queue and apply when the agent reaches a safe point, never mid-step
5. **Spawn** new sessions and teams with per-member model/effort choices

The design deliberately optimizes for: attention management (what needs *me*?), honest system state (no fake progress bars), auditability (permission grants are visible and revocable), and reversibility (undo for destructive actions).

## About the Design Files

The files in this bundle are **design references created in HTML** — an interactive prototype showing intended look and behavior, **not production code to copy directly**. The prototype is a single self-contained page with simulated agent behavior (`setTimeout`/`setInterval` fakes: agents emit events on a timer, approvals "run" after ~14s, revised drafts arrive after ~12s).

Your task is to **recreate this design in the target codebase's environment** (React/Vue/Svelte + your real agent backend) using its established patterns and libraries. If no environment exists yet, a sensible default: React + TypeScript, a WebSocket or SSE event stream from the agent runtime, and a state store (Zustand/Redux) mirroring the data model below.

`Switchboard Prototype v3.html` is the canonical reference. (`support.js` is the prototype's rendering runtime — ignore it entirely; it is not part of the design.)

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, and copy in the prototype are final design intent — recreate the UI pixel-perfectly using your codebase's component library. The *simulation timings* (8s step boundaries, 12s revision arrival) are placeholders for real agent events, and the demo content (session names, transcripts) is illustrative.

---

## Data Model

Everything renders from four entities. Field names below match the prototype's source so you can cross-reference.

### Session
```
id           string
name         string        display name incl. role prefix ("Lead · planner", "Worker · docs")
short        string        slug used in chips/toasts ("qa-sweep")
baseName     string        name without role prefix; role prefixes are recomputed on promote/move
teamId       string|null   null = independent session
lead         boolean       exactly one lead per team
status       enum          running | waiting | error | paused | stopped | done
statusLine   string        one-line human status ("Waiting for approval", "31 of 90 emails")
phase        enum          planning | executing | reviewing | gated | blocked | stopped | done
msDone/msTotal  int        milestone progress (segments, NOT a percentage)
startedAt    timestamp
cost         float         accumulated $ spend
model        enum          haiku | sonnet | opus
effort       enum          low | medium | high   (thinking + retry budget)
ctx          int           % of context window used
dep          string        dependency note shown as amber badge ("gates release sign-off")
pendingModel / pendingEffort   enum|null   queued change, applies at next step boundary
pendingMove  {target: teamId|null, label} | null   queued team move
```

### Event (feed item)
```
id        string
ts        timestamp
sid       session id
kind      enum      info | message | artifact | approval | error | review
verb      string    headline ("wants to run a command", "produced an artifact")
own       boolean   true if caused by the USER (approve, move, etc.) — affects unread logic
resolved  null | 'approved'|'allowed'|'denied'|'retried'|'batched'|'approved-art'|'changes-req'
-- kind-specific:
command       string    (approval) the command text
grantPattern  string    (approval) pattern registered if user picks "allow for session"
why           string    (approval/error/review) agent's reasoning — ALWAYS shown
chipsV        string[]  sandbox-VERIFIED facts (green ✓ chips)
chipsC        string[]  agent-CLAIMED facts (dashed "agent:" chips) — visually distinct on purpose
body          string    supporting prose
artName/artExt/artMeta  (artifact/review)
artPreview    [text, style][]  document preview lines; style: h=title s=section n=normal c=changed m=muted
```

### Team
```
id, name, goal   strings
startedAt        timestamp
```

### Grant (session permission)
```
id, sid, pattern ("npm run test:e2e *"), grantedAt
Lifecycle: created by "Allow this pattern for session"; ends with session; revocable anytime.
```

### Transcript message
```
k: note | text | tool | user | perm
note = gray centered pill (task assignment); text = agent prose; tool = mono tool-call row;
user = right-indented user bubble; perm = embedded permission card referencing an approval event
```

---

## Screens / Views

The app is one screen with three tabs (Feed / Sessions / Teams), a persistent left rail, an optional right split pane (session detail), and overlays (review modal, grants popover, new-session modal, undo toast).

### Global frame
- App background `#faf9f7`; text `#1c1b18`; font: **IBM Plex Sans** (UI) + **IBM Plex Mono** (timestamps, commands, code, meta)
- **Top bar** — 52px, white, bottom border `#e7e4de`, padding 0 20px, flex gap 16px:
  - Wordmark "Switchboard" 15px/700
  - Tab switcher: segmented control in `#f1efeb` pill (radius 8, 2px padding); active tab = white bg, radius 6, shadow `0 1px 2px rgba(0,0,0,.06)`, 12.5px/600; inactive 12.5px `#6d6a63`
  - Right cluster: live status "6 running · 2 need you" (12px `#6d6a63` with pulsing 7px green dot — 2.4s opacity keyframe); **Grants · N** pill (bordered, opens grants popover; hidden when zero); **+ New session** primary button (dark `#1c1b18` bg, white text, radius 8, 7px 14px, hover `#3a3833`)

### Left rail (all tabs)
- 238px, white, right border `#e7e4de`, scrollable, padding 14px 10px
- One group per team (header = team name uppercase, 10.5px/600, letter-spacing .08em, `#9a968d`) + trailing INDEPENDENT group — groups are dynamic, regenerated as teams change
- Session row: 8px status dot + name (12.5px; 600 if lead/selected) + statusLine (11px `#8a867d`; amber `#c07018` when waiting, red `#b03a24` on error, clay `#9a5243` when stopped). Hover `#f4f2ee`; selected also `#f4f2ee`. Click opens the session split pane.

### Status color system (single source of truth)
| status  | dot/accent | pill bg/text |
|---|---|---|
| running | `#3f9d63` | `#eef7f1` / `#2e7c4d` |
| waiting | `#d98324` | `#fdf3e2` / `#c07018` |
| error   | `#c4432b` | `#fdf0ec` / `#b03a24` |
| paused  | `#8a867d` | `#f1efeb` / `#6d6a63` |
| stopped | `#b0776b` | `#f7ece9` / `#9a5243` |
| done    | `#b6b2a8` | `#f1efeb` / `#8a867d` |

**Stopped ≠ done is intentional** — a session the user killed must never present as a successful completion.

### 1 · Feed tab (default)

Column, padding 18px 26px, scrollable.

**A. "Needs you" pinned block** (top, only when unresolved decisions exist)
- Header: "Needs you" 13px/700 + orange count badge (18px round, `#d98324`) + hint "oldest first · pinned until you decide" (11px `#9a968d`)
- Cards sorted **oldest-first** (longest-waiting = most urgent), **capped at 2** with a "+N more waiting — show all" / "Collapse" toggle (11.5px/600 `#2a6fdb`)
- Card anatomy (white, radius 12, padding 14px 16px, shadow `0 1px 3px rgba(0,0,0,.05)`, 1px border + **3px left accent edge**):
  - approval: edge/border `#d98324`/`#ecd9b8` · error: `#c4432b`/`#ecc7bd` · review: `#2a6fdb`/`#dbe5f5`
  - Row 1: status dot, session name 12.5px/600, verb 11.5px `#9a968d`, spacer, relative time 11px `#b6b2a8`
  - **"Why:" line** — agent's reasoning, 12px `#6d6a63`, bold label. Every decision must carry a why.
  - Optional command block (mono 12px, `#f7f5f1` bg, border `#eceae4`, radius 8, padding 9px 12px)
  - **Fact chips row**: verified = `✓ <text>` green (`#eef7f1` bg, `#2e7c4d` text, radius 10) with tooltip "Verified by the sandbox"; claimed = `agent: <text>` (white bg, **1px dashed** `#d5d1c8` border, `#8a867d`) with tooltip "Claimed by the agent — not verified". Never restyle claims as verified.
  - Action row by kind:
    - approval: **Approve once** (primary dark) · **Allow this pattern for session** (bordered; also registers a Grant) · **Deny** (bordered)
    - error: **Retry now** (primary) · alternative-fix suggestion (bordered, e.g. "Try smaller batches") · **Open session**
    - review: **Open review** (primary) · **"Approve without reading"** (bordered, muted `#6d6a63`) — this honest label is deliberate; do not shorten to "Approve"

**B. Activity header row**
- "Activity" 15px/700 + "N new" unread badge (`#d98324` pill) when unread > 0
- Right cluster (wraps): **search input** (pill, 130px, placeholder "Search events…", filters live on verb/artifact/session name) · **session-filter chip** (blue `#2a6fdb` pill "qa-sweep ✕", shown when filtering by session; click clears) · filter pills **All / Unread · N / Artifacts / Errors** (active = dark fill; inactive bordered) · **Mark caught up** (blue text button, shown when unread > 0)

**C. "While you were away" digest** — shown when returning with ≥3 unread; white card, blue-tinted border `#dbe5f5`; title 12.5px/700 `#2a5cb8`; meta "Xm away · N events"; up to 4 one-liners `**session** — verb`, each clickable → filters feed to that session; Dismiss link. Mark-caught-up also dismisses.

**D. Event stream** (8px gaps)
- **Compact rows** (kind=info or resolved decisions): dot + `**session name** verb` 12px + time. Session name is clickable → session filter.
- **Cards** (message/artifact/review): white radius 12, padding 14 16; header like pinned; body/artifact box inside. Artifact box (gray `#f7f5f1`, radius 8, doc-icon 30×36 with EXT label, name 12.5px/600 + meta 11px) is **clickable → opens review/preview modal**. Resolved review cards re-verb to "artifact approved by you" / "revising after your feedback".
- **Unread treatment**: 2px left border `#d98324` + faint warm bg `#fffcf5` on unread rows/cards
- **"CAUGHT UP TO HERE" divider** between new and seen (1px lines + 10.5px caps label) — only in unfiltered view
- User-caused events carry `own:true`: never counted as unread; verbs are auditable past-tense ("command denied by you", "move queued: → Independent…")
- Empty state: "Nothing here — you're all caught up." centered 13px `#9a968d`

**E. Live simulation → real backend**: prototype pushes an info event every ~9s and bumps cost/context. Replace with your event stream; keep **newest-first prepend** and the ~250ms fade/slide-in (`opacity 0→1, translateY(-6px→0)`).

### 2 · Sessions tab
- "All sessions" 15px/700; responsive grid `repeat(auto-fill, minmax(280px, 1fr))`, 12px gaps
- Card: white radius 12, padding 14 16 — dot + name 13px/600 + status pill · statusLine 12px (min-height 34px) · **milestone segments** (msTotal equal bars, 4px tall, radius 2; done = status color, rest `#f1efeb`) — never a smooth % bar · meta row mono 10.5px `#9a968d`: `Model·effort · phase · done/total · elapsed` + cost right-aligned. Click → split pane.

### 3 · Teams tab
- Header "Teams" + **+ New team** (bordered) → opens spawn modal in New-team mode
- **One card per team** (max-width 640, min-width 420): name 13.5px/700 + "N agents · started Xh Ym ago" + **+ Add member** (blue link) → modal in existing-team mode, preselected. Goal 12px `#6d6a63`.
- **Member tree**: lead first, workers with `├`/`└` glyphs (mono, `#c9c5bc`). Row: dot · name 12.5px/600 · role 11px · `Model·effort` mono tag (+ ⏳ when changes queued) · optional amber dep badge · statusLine · **⋯ manage toggle**
- **Manage panel** (expands under row; `#f7f5f1`, radius 10):
  - MODEL chips Haiku/Sonnet/Opus + EFFORT chips Low/Med/High — three chip states: current (dark fill) / **pending (amber `#fdf3e2` bg, `#d98324` border)** / idle (bordered). Click idle → **queues** change; click pending → cancels.
  - Pending notes: `⏳ Sonnet → Opus at next step · ≈5× step cost` (model, from rate ratio haiku 1 : sonnet 3 : opus 15) / `effort low → high at next step · more thinking budget` — each with inline **cancel**
  - MOVE `→ <other team>` / `→ Independent` + **Make lead** (non-leads)
  - Footer: "Changes apply at the next step boundary · effort sets thinking + retry budget" 10px `#9a968d`
- **Move confirm** (amber card, replaces MOVE row): "Move to X?" + consequence lines: handoff ("Finishes its current step, then hands context to <lead>"), ⚠ red dependency warning if `dep` set ("qa-sweep gates release sign-off — Release v2.4 loses this gate"), lead succession ("Lead role passes to changelog"). **Move at next step** / Cancel.
- **Independent sessions card** below with same row + manage pattern (no lead/branch)
- Structural rules: moving the lead auto-promotes first remaining member (rename to "Lead · <baseName>"); emptying a team disbands it; role prefixes always recomputed; moved member's `dep` cleared

### 4 · Session split pane (non-modal)
Opens on session click; `width: clamp(340px, 44vw, 440px)`, white, left border + shadow; **feed stays live beside it**.
- Header: dot 9px + name 14.5px/700 + status pill + ✕ · meta 11.5px `#8a867d`: group line ("Release v2.4 · reports to planner" / "· lead" / "Independent session"), "Opus · 34% context", cost, **"Grants · N"** underlined link when grants exist → opens grants popover
- Milestone segments (max 150px) + mono phase line `gated on you · 3/5 · 50m`
- MODEL/EFFORT chip rows (same queue semantics) + pending ⏳ notes
- Amber dep badge if set
- Action row: **Pause/Resume** (bordered; disabled for stopped/done) · **Hand off** (bordered) · spacer · **Stop** (red-bordered `#f0d4cd`/`#b03a24`) → **inline confirm**: "Stop this session?" + red **Confirm stop** `#c4432b` + Keep running
- Transcript (`#fbfaf8`, message types per data model; perm cards show live Approve-once/Deny or resolved label ("✓ Approved once — running"))
- Composer: input "Message <short>…" + dark Send; Enter sends. Prototype fakes a reply in ~1.6s + emits an own-event; wire to real session messaging.

### 5 · Artifact review modal
Centered 600px card (max-height 86%, radius 14, shadow `0 16px 48px rgba(28,27,24,.2)`) over scrim `rgba(28,27,24,.28)`; scrim/✕ closes.
- Header: doc icon + filename 13.5px/700 + meta "changelog · Draft v2 · 1,310 words"
- Body (`#fbfaf8`, scrollable): preview lines styled by role — h: 15px/700 · s: 12.5px/700 section · n: 12.5px `#4a4741` lh 1.55 · **c (changed): amber-highlighted with 2px `#d98324` left bar + `#fdf9f1` bg** · m: muted italic. Revisions include legend "▍ = changed since previous draft".
- Footer (unresolved review): optional note input "Optional note for the agent…" + **Approve artifact** (primary) + **Request changes** (bordered). Resolved/plain artifacts show status line instead ("✓ Approved by you" / "Delivered — no review needed").
- **Review lifecycle**: request-changes → note lands in worker transcript as user message, worker status "Revising notes per your feedback" → revised draft **returns as new pinned review** (v2, changed lines marked). Approve → worker publishes and completes; lead reacts (if QA also resolved: "all release gates green — preparing to ship v2.4"). This loop must close — reviews may not dead-end.

### 6 · Grants popover
Anchored top-right (370px, radius 12, shadow, z-top). Title "Session permissions" + ✕; explainer "Patterns agents may run without asking. Grants end when their session ends." (11.5px `#8a867d`). Per grant: mono pattern 11.5px + "qa-sweep · granted 12m ago" + red-bordered **Revoke** (undoable). Empty: "No active grants."

### 7 · New session / team modal
Centered 560px card. Mode switcher: **Independent / Existing team / New team** (Existing hidden when no teams).
- Independent: task textarea + Model + Effort chip pickers → **Start session**
- Existing team: + team picker chips → **Add to team** (joins as worker; transcript notes syncing with lead's plan)
- New team: name input, goal textarea, **member list** — each row: LEAD (dark) or WORKER badge, task input, model + effort chips, ✕ remove (min 1 row); "+ Add member"; defaults lead=Opus/high, workers=Sonnet/medium → **Start team** (first row = lead, names "Lead · <slug>"/"Worker · <slug>", switches to Teams tab)

### 8 · Undo toast
Bottom-center dark pill (`#1c1b18`, radius 10, shadow): label 12.5px + **Undo** (amber `#f0b35c`, 700) + ✕. One at a time, newest replaces; ~7s auto-dismiss. Undoable: deny, queued model/effort/move (undo = cancel queue), promote, stop, artifact approve (within window), request-changes, grant revoke. Undo emits its own feed event ("denial undone — approval request reopened").
**Implementation caution**: some prototype undos are only honest *before* the backend acts (deny/stop). Where the runtime can't restore state, present **"re-request" / "re-run"** semantics instead of "undo" — do not fake reversibility.

---

## Interactions & Behavior

**Step-boundary rule (core semantic)** — model, effort, and team-move changes never interrupt an agent mid-step: clicking queues the change (pending chip + ⏳ note + toast), it applies at the next step boundary (prototype: ~8s timer; real: your runtime's boundary), then a feed event confirms ("switched to Opus at step boundary", "handed off to Release v2.4 — context transferred"). Pending anything is cancellable. Only pause and stop act immediately.

**Approval flow** — Approve once → status running, feed event, later outcome event (e2e passes → "48/48 · release candidate verified", QA msDone++). Allow-pattern → same + Grant registered. Deny → agent adapts ("will summarize findings without e2e") — denial redirects, it doesn't kill.

**Error flow** — Retry / alternative fix / open session; recovery arrives as later events ("connection restored — resuming from checkpoint"). Alternative fix paths must be first-class buttons, not buried.

**Unread model** — `lastSeen` timestamp; unread = `ts > lastSeen && !own`. Mark-caught-up sets lastSeen=now and dismisses digest. Digest appears on return with ≥3 unread.

**Timing constants (prototype)** — sim event ~9s (tweakable 3–30s); step boundary 8s; e2e outcome 14s; error recovery 9s; revised draft 12s; chat reply 1.6s; toast 7s; clock rerender 20s.

**Animations** — new events/cards/panels: 200–250ms ease fade + 6px slide-down (`sbin`); status dot pulse 2.4s; hovers instant. Nothing else moves.

**Known gaps (deliberately unimplemented — decide during implementation)**: Hand off button is dead; drawer transcripts don't receive live sim events; no keyboard shortcuts or focus management (add proper a11y: Esc closes overlays, y/n on approvals, j/k triage nav, visible focus rings); no aggregate cost rollup/budget caps; no task-board view of a lead's plan; no away-state notifications (title badge, browser notifications) or waiting-time escalation on pinned cards; feed virtualization needed >200 events; no mute-session affordance.

---

## State Management

- `tab`, `filter` (all|unread|artifacts|errors), `search`, `sessionFilter`, `selectedId` (split pane), `expandedMemberId`, `moveConfirm`, `reviewOpen` (event id), `revComment`, `grantsOpen`, `pinnedShowAll`, `confirmStop`, `lastSeen`, `digestDismissed`, `toast` (+ pending undo fn), modal state (`modalOpen`, `modalMode`, `targetTeamId`, `teamName`, `draftMembers[]`, `memberModel`, `memberEffort`, `promptText`), `chatText`
- Collections: `sessions[]`, `teams[]`, `events[]` (newest first), `grants[]`, `transcripts{sid: msg[]}`
- Derived per render: unresolved decisions (approval/error/review, unresolved) → pinned set; unread count; filtered stream; rail groups; per-team member lists (lead first)
- Real backend: events + session patches arrive over a stream; user actions are optimistic with server confirm; undo windows should map to server-side grace periods where possible

## Design Tokens

**Colors** — bg `#faf9f7` · surface `#fff` · surface-2 `#f7f5f1` · surface-3 `#f1efeb` · borders `#e7e4de` / `#eceae4` / `#e0ddd6` · text `#1c1b18` / `#4a4741` / `#6d6a63` / `#8a867d` / `#9a968d` / `#b6b2a8` · primary `#1c1b18` (hover `#3a3833`) · info-blue `#2a6fdb` (dark `#2a5cb8`, tint `#dbe5f5`/`#eef3fc`) · status colors per table above · amber tints `#fdf9f1`/`#fdf3e2`/`#ecd9b8` · red tints `#fdf4f1`/`#fdf0ec`/`#ecc7bd`/`#f0d4cd` · green tint `#eef7f1` · clay tint `#f7ece9` · toast accent `#f0b35c`

**Type** — IBM Plex Sans 400/500/600/700; IBM Plex Mono 400/500/600. Scale: 15px titles/wordmark · 14.5px pane title · 13.5px card titles · 12.5px body/buttons · 12px secondary · 11.5px meta · 11px timestamps · 10.5px pills/labels · 10–9.5px micro-labels (caps, letter-spacing .07–.08em)

**Radii** — 4px doc icons · 6–7px small buttons/segments · 8px buttons/inputs/command blocks · 9–10px chips/panels · 12px cards · 14px modals · 20px search/filter pills · 50% dots

**Shadows** — card `0 1px 2px rgba(0,0,0,.04)` · pinned `0 1px 3px rgba(0,0,0,.05)` · hover `0 3px 12px rgba(0,0,0,.08)` · pane `-12px 0 32px rgba(28,27,24,.12)` · popover `0 12px 32px rgba(28,27,24,.16)` · modal `0 16px 48px rgba(28,27,24,.2)` · toast `0 8px 24px rgba(28,27,24,.3)`

**Spacing** — 4px base: 6/8/10 within components · 12/14/16 padding · 18/20/26 page gutters. Dots 7–9px; segments 4px; accent edges 2–3px.

## Assets

None. No images or icon fonts — icons are unicode glyphs (✕ ✓ ⏳ ⚠ ├ └ ⋯ ▸ ▍) and CSS shapes. Fonts from Google Fonts (IBM Plex Sans + Mono); self-host in production.

## Files

- `Switchboard Prototype v3.html` — canonical interactive prototype (open in a browser; all flows work with simulated agents)
- `support.js` — prototype rendering runtime; **not part of the design**, do not port
- Earlier iterations (v1/v2 in the design project) show the evolution but v3 supersedes them

## Suggested implementation order

1. Data model + event stream plumbing; static feed rendering (compact rows, cards, unread)
2. Pinned triage (approval/error/review) + resolution flows
3. Session split pane (transcript, chat, pause/stop-confirm)
4. Teams tab + step-boundary queue mechanics (model/effort/move + pending UI + toasts)
5. Review modal + closed review loop; grants registry
6. Spawn modals; digest/mark-caught-up; search + session filter
7. A11y + keyboard layer; then the "Known gaps" list as product decisions

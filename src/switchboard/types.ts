export type SessionStatus =
  | "running"
  // Alive with nothing in flight — the process is up and ready for the
  // next message, but not doing anything right now.
  | "idle"
  | "waiting"
  | "error"
  | "paused"
  | "stopped"
  | "done";

export type SessionPhase =
  | "planning"
  | "executing"
  | "reviewing"
  | "gated"
  | "blocked"
  | "stopped"
  | "done";

export type Model = "haiku" | "sonnet" | "opus";
export type Effort = "low" | "medium" | "high";

export interface PendingMove {
  target: string | null;
  label: string;
}

export interface Session {
  id: string;
  name: string;
  short: string;
  baseName: string;
  teamId: string | null;
  lead: boolean;
  status: SessionStatus;
  statusLine: string;
  phase: SessionPhase;
  msDone: number;
  msTotal: number;
  startedAt: number;
  cost: number;
  model: Model;
  effort: Effort;
  ctx: number;
  dep: string;
  pendingModel: Model | null;
  pendingEffort: Effort | null;
  pendingMove: PendingMove | null;
  dir: string;
  worktreePath: string | null;
  branch: string | null;
  useWorktree: boolean;
  mcpConfigIds: string[];
}

export type EventKind =
  | "info"
  | "message"
  | "artifact"
  | "approval"
  | "error"
  | "review";

export type EventResolution =
  | null
  | "approved"
  | "allowed"
  | "denied"
  | "retried"
  | "batched"
  | "approved-art"
  | "changes-req";

export type ArtifactPreviewStyle = "h" | "s" | "n" | "c" | "m";

export interface FeedEvent {
  id: string;
  ts: number;
  sid: string;
  kind: EventKind;
  verb: string;
  own: boolean;
  resolved: EventResolution;
  command?: string;
  grantPattern?: string;
  altFix?: string;
  why?: string;
  chipsV?: string[];
  chipsC?: string[];
  body?: string;
  artName?: string;
  artExt?: string;
  artMeta?: string;
  artPreview?: [string, ArtifactPreviewStyle][];
}

export type TeamCoordination = "classic" | "sequenced" | "autonomous";

export interface Team {
  id: string;
  name: string;
  goal: string;
  dir: string;
  baseRef: string;
  startedAt: number;
  mcpConfigIds: string[];
  coordination: TeamCoordination;
  workersStarted: boolean;
  useWorktree: boolean;
}

export type McpTransport = "stdio" | "http" | "sse";

export interface McpConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command: string; // stdio only
  args: string[]; // stdio only
  env: Record<string, string>; // stdio only
  url: string; // http/sse only
  headers: Record<string, string>; // http/sse only
}

export interface Grant {
  id: string;
  sid: string;
  pattern: string;
  grantedAt: number;
}

// "skipped" is a one-shot schedule that came due while the app wasn't
// running and the user opted out of startup catch-up — see
// `catchUpMissedSchedules` on Snapshot. A recurring schedule never gets
// this status; it just silently advances to its next future occurrence.
export type ScheduleStatus = "pending" | "fired" | "failed" | "skipped";

// A spawn payload carries the exact body shape POST /sessions accepts for
// mode "new" or "solo" — the scheduler fires it through the same
// spawnFromBody() parsing the live route uses, so there's one source of
// truth for what a valid spawn body looks like.
export interface ScheduleSpawnPayload {
  kind: "spawn";
  body: Record<string, unknown>;
}

export interface ScheduleMessagePayload {
  kind: "message";
  sessionId: string;
  // Snapshot of the session's name at schedule time, so the list (and any
  // "no longer running" error) still reads sensibly if the session is later
  // renamed or deleted.
  sessionLabel: string;
  text: string;
}

export type SchedulePayload = ScheduleSpawnPayload | ScheduleMessagePayload;

// Recurrence only applies to spawn-kind schedules — a recurring message
// needs a target session that outlives every occurrence, which doesn't fit
// how sessions actually work (they finish/get deleted), so "message"
// schedules stay one-shot.
export type RecurrenceUnit = "minutes" | "hours" | "days";

export interface IntervalRecurrence {
  kind: "interval";
  unit: RecurrenceUnit;
  every: number; // fire every N `unit`s
}

export interface WeeklyRecurrence {
  kind: "weekly";
  daysOfWeek: number[]; // 0=Sun..6=Sat, local time, at least one
  hour: number; // 0-23, local
  minute: number; // 0-59, local
}

export type Recurrence = IntervalRecurrence | WeeklyRecurrence;

export interface Schedule {
  id: string;
  label: string;
  runAt: number;
  createdAt: number;
  status: ScheduleStatus;
  error?: string;
  payload: SchedulePayload;
  recurrence: Recurrence | null;
  // How many times this has fired — recurring schedules stay "pending" and
  // reuse the same id/row across occurrences rather than spawning a new
  // Schedule each time, so this is the only record of how many times it's run.
  occurrenceCount: number;
}

export type TranscriptMessageKind = "note" | "text" | "tool" | "user" | "perm" | "summary";

export interface TranscriptMessage {
  k: TranscriptMessageKind;
  text?: string;
  eventId?: string;
}

export interface Snapshot {
  sessions: Session[];
  teams: Team[];
  events: FeedEvent[];
  grants: Grant[];
  transcripts: Record<string, TranscriptMessage[]>;
  mcpConfigs: McpConfig[];
  schedules: Schedule[];
  // Opt-in: whether a schedule that came due while the app was closed
  // should fire immediately on the next launch. Defaults to false — a
  // missed one-shot schedule is marked "skipped" instead of firing late,
  // and a missed recurring schedule silently advances to its next future
  // occurrence rather than firing for the time it missed.
  catchUpMissedSchedules: boolean;
  // In-app Anthropic API key status. Only status — the key itself never
  // leaves the server. Tail is the last few characters, for "which key is
  // this" display.
  apiKeyConfigured: boolean;
  apiKeyTail: string | null;
}

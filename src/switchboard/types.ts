export type SessionStatus =
  | "running"
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

export interface Team {
  id: string;
  name: string;
  goal: string;
  dir: string;
  baseRef: string;
  startedAt: number;
}

export interface Grant {
  id: string;
  sid: string;
  pattern: string;
  grantedAt: number;
}

export type TranscriptMessageKind = "note" | "text" | "tool" | "user" | "perm";

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
}

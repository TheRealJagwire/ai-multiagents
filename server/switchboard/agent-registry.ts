// In-memory bookkeeping for live Agent SDK sessions: the running Query per
// Switchboard session id, and pending tool-call approvals waiting on a human
// to click approve/deny in the feed.

import type { Query } from "npm:@anthropic-ai/claude-agent-sdk@^0.3.204";

export interface AgentSessionHandle {
  query: Query;
  pushMessage: (text: string) => void;
  dir: string;
  // The process's cwd — a real worktree checkout, or `dir` itself when the
  // session opted out of git/worktrees (see `branch`).
  worktreePath: string;
  // null means this session opted out of git/worktrees entirely — cwd is
  // `dir` directly, and there's no worktree/branch for cleanup to remove.
  branch: string | null;
  sessionAllowAll: boolean;
  // Set by togglePause: whether the session had a turn in flight when it
  // was paused. Resume only sends "Continue." if something was actually
  // interrupted — resuming an idle session must not start (and bill) a
  // fresh turn.
  pausedMidTurn?: boolean;
}

const sessions = new Map<string, AgentSessionHandle>();

export function registerAgentSession(sid: string, handle: AgentSessionHandle): void {
  sessions.set(sid, handle);
}

export function getAgentSession(sid: string): AgentSessionHandle | undefined {
  return sessions.get(sid);
}

export function unregisterAgentSession(sid: string): void {
  sessions.delete(sid);
}

export function markSessionAllowAll(sid: string): void {
  const handle = sessions.get(sid);
  if (handle) handle.sessionAllowAll = true;
}

// Kept deliberately smaller than the SDK's own PermissionResult — the
// caller resolving an approval (resolutions.ts) never has the original tool
// input in hand, so it can't fill in PermissionResult's "allow" variant's
// required `updatedInput`. agent-sessions.ts closes over the input itself
// and builds the real PermissionResult from this decision.
export type ApprovalDecision = { allow: true } | { allow: false; message: string };

const pending = new Map<string, (decision: ApprovalDecision) => void>();

export function registerPendingApproval(feedEventId: string, resolve: (decision: ApprovalDecision) => void): void {
  pending.set(feedEventId, resolve);
}

export function resolvePendingApproval(feedEventId: string, decision: ApprovalDecision): boolean {
  const resolve = pending.get(feedEventId);
  if (!resolve) return false;
  pending.delete(feedEventId);
  resolve(decision);
  return true;
}

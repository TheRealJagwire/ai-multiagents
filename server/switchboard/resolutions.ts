import { findEvent, findSession } from "./state.ts";
import { addGrant, pushFeedEvent, pushSessionPatch, removeGrant, resolveEvent } from "./mutations.ts";
import { registerUndo } from "./undo.ts";
import { getAgentSession, markSessionAllowAll, resolvePendingApproval } from "./agent-registry.ts";

export function approveEvent(id: string, scope: "once" | "session"): void {
  const ev = findEvent(id);
  if (ev.resolved !== null) return;

  const session = findSession(ev.sid);
  const prevSessionPatch = { status: session.status, statusLine: session.statusLine, phase: session.phase };

  resolveEvent(id, scope === "session" ? "allowed" : "approved");
  const grant = scope === "session" ? addGrant(ev.sid, ev.grantPattern ?? "command *") : null;

  pushSessionPatch(ev.sid, {
    status: "running",
    statusLine: "Running the approved command",
    phase: "executing",
  });
  pushFeedEvent({
    sid: ev.sid,
    kind: "info",
    own: true,
    verb: scope === "session"
      ? "pattern allowed for this session — command started"
      : "approved once by you — command started",
  });

  resolvePendingApproval(id, { allow: true });
  if (scope === "session") markSessionAllowAll(ev.sid);

  registerUndo(id, () => {
    resolveEvent(id, null);
    if (grant) removeGrant(grant.id);
    pushSessionPatch(ev.sid, prevSessionPatch);
    pushFeedEvent({ sid: ev.sid, kind: "info", own: true, verb: "approval undone — review reopened" });
  });
}

export function denyEvent(id: string): void {
  const ev = findEvent(id);
  if (ev.resolved !== null) return;

  const session = findSession(ev.sid);
  const prevSessionPatch = { status: session.status, statusLine: session.statusLine, phase: session.phase };

  resolveEvent(id, "denied");
  pushSessionPatch(ev.sid, { status: "running", statusLine: "Skipping, wrapping up", phase: "reviewing" });
  pushFeedEvent({ sid: ev.sid, kind: "info", own: true, verb: "command denied by you" });

  resolvePendingApproval(id, { allow: false, message: "Denied by the user." });

  registerUndo(id, () => {
    resolveEvent(id, null);
    pushSessionPatch(ev.sid, prevSessionPatch);
    pushFeedEvent({ sid: ev.sid, kind: "info", own: true, verb: "denial undone — approval request reopened" });
  });
}

export function retryEvent(id: string): void {
  const ev = findEvent(id);
  if (ev.resolved !== null) return;

  resolveEvent(id, "retried");
  pushSessionPatch(ev.sid, { status: "running", statusLine: "Retrying…", phase: "executing" });
  pushFeedEvent({ sid: ev.sid, kind: "info", own: true, verb: "retry requested by you" });

  getAgentSession(ev.sid)?.pushMessage("Please retry.");
}

export function applyAltFix(id: string): void {
  const ev = findEvent(id);
  if (ev.resolved !== null || !ev.altFix) return;

  resolveEvent(id, "batched");
  pushSessionPatch(ev.sid, { status: "running", statusLine: `Retrying — ${ev.altFix}`, phase: "executing" });
  pushFeedEvent({ sid: ev.sid, kind: "info", own: true, verb: `switched to "${ev.altFix}" at your direction` });

  getAgentSession(ev.sid)?.pushMessage(ev.altFix);
}

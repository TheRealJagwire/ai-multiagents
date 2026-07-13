import { findSession, state } from "./state.ts";
import { pushFeedEvent, pushSessionPatch, pushSessionRemove, pushTranscriptRemove, removeGrant } from "./mutations.ts";
import { getAgentSession, unregisterAgentSession } from "./agent-registry.ts";
import { removeWorktree } from "./git-worktree.ts";
import { slugFrom, uniqueBaseName } from "./spawn-actions.ts";

export function togglePause(sid: string): void {
  const session = findSession(sid);
  if (session.status === "done" || session.status === "stopped") return;

  const handle = getAgentSession(sid);
  if (!handle) return;

  const paused = session.status === "paused";

  if (paused) {
    // Resume: only nudge the agent if pause actually interrupted a turn —
    // "Continue."-ing an idle session would start (and bill) a brand-new
    // turn the user never asked for.
    const midTurn = handle.pausedMidTurn === true;
    handle.pausedMidTurn = false;
    pushSessionPatch(
      sid,
      midTurn
        ? { status: "running", statusLine: "Resuming…" }
        : { status: "idle", statusLine: "Idle — ready for the next message", phase: "reviewing" },
    );
    pushFeedEvent({ sid, kind: "info", own: true, verb: "resumed by you" });
    if (midTurn) handle.pushMessage("Continue.");
  } else {
    handle.pausedMidTurn = session.status === "running" || session.status === "waiting";
    pushSessionPatch(sid, { status: "paused", statusLine: "Paused by you" });
    pushFeedEvent({ sid, kind: "info", own: true, verb: "paused by you" });
    handle.query.interrupt().catch((err) => {
      pushFeedEvent({ sid, kind: "error", own: false, verb: `failed to pause: ${String(err)}` });
    });
  }
}

// Interrupts and closes the local Agent SDK process (if one is still
// running), then removes the session's git worktree — any uncommitted work
// is auto-committed first (see git-worktree.ts) — while always keeping the
// branch. Shared by stopSession and deleteSession: both are real,
// irreversible cleanup steps, so neither carries an undo.
function terminateAgentProcess(sid: string): void {
  const handle = getAgentSession(sid);
  if (!handle) return;
  unregisterAgentSession(sid);

  (async () => {
    await handle.query.interrupt().catch(() => {});
    handle.query.close();
    if (handle.branch) {
      await removeWorktree(handle.dir, handle.worktreePath);
      pushFeedEvent({ sid, kind: "info", own: false, verb: `worktree removed — work saved on branch ${handle.branch}` });
    }
  })().catch((err) => {
    pushFeedEvent({ sid, kind: "error", own: false, verb: `failed to clean up worktree: ${String(err)}` });
  });
}

export function stopSession(sid: string): void {
  const session = findSession(sid);
  if (session.status === "stopped" || session.status === "done") return;

  pushSessionPatch(sid, { status: "stopped", statusLine: "Stopped by you", phase: "stopped" });
  pushFeedEvent({ sid, kind: "info", own: true, verb: "stopped by you" });
  terminateAgentProcess(sid);
}

// Deleting terminates the same way Stop does, but the session also
// disappears from every list instead of sticking around in a "stopped"
// state. Past feed events referencing this session id are left in place as
// history — the feed already tolerates events whose session no longer
// exists (e.g. any event rendered after a stop-and-forget).
export function deleteSession(sid: string): void {
  const session = state.sessions.find((s) => s.id === sid);
  if (!session) return;

  if (session.status !== "stopped" && session.status !== "done") {
    terminateAgentProcess(sid);
  } else if (!getAgentSession(sid) && session.worktreePath && session.branch && session.worktreePath !== session.dir) {
    // Crash-orphaned worktree: the session was restored from disk (no live
    // handle), so terminateAgentProcess never runs — remove its worktree
    // here or it lingers in <repo>-worktrees/ forever. Best-effort: the
    // path may already be gone.
    removeWorktree(session.dir, session.worktreePath).catch(() => {});
  }
  pushFeedEvent({ sid, kind: "info", own: true, verb: "deleted by you" });
  pushSessionRemove(sid);
  // The session's transcript and grants go with it — leaving them behind
  // leaked them into memory and state.json for the life of the install.
  pushTranscriptRemove(sid);
  for (const grant of state.grants.filter((g) => g.sid === sid)) removeGrant(grant.id);
}

export function sendMessage(sid: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  getAgentSession(sid)?.pushMessage(trimmed);
}

// The name is the session's user-facing identity (independent of its task
// prompt), so renaming updates the display name, the role-prefixed variant,
// and the short chip — but never the git branch, which was cut at spawn
// time and may already have commits on it.
export function renameSession(sid: string, rawName: string): void {
  const session = findSession(sid);
  const trimmed = rawName.trim();
  if (!trimmed) throw new Error("name is required");
  const baseName = uniqueBaseName(trimmed, sid);
  const name = session.teamId ? `${session.lead ? "Lead" : "Worker"} · ${baseName}` : baseName;
  pushSessionPatch(sid, { name, baseName, short: slugFrom(baseName) });
  pushFeedEvent({ sid, kind: "info", own: true, verb: `renamed to "${baseName}"` });
}

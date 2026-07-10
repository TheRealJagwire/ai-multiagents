import { findSession, state } from "./state.ts";
import { pushFeedEvent, pushSessionPatch, pushSessionRemove } from "./mutations.ts";
import { getAgentSession, unregisterAgentSession } from "./agent-registry.ts";
import { removeWorktree } from "./git-worktree.ts";

export function togglePause(sid: string): void {
  const session = findSession(sid);
  if (session.status === "done" || session.status === "stopped") return;

  const handle = getAgentSession(sid);
  if (!handle) return;

  const paused = session.status === "paused";
  pushSessionPatch(sid, {
    status: paused ? "running" : "paused",
    statusLine: paused ? "Resuming…" : "Paused by you",
  });
  pushFeedEvent({ sid, kind: "info", own: true, verb: paused ? "resumed by you" : "paused by you" });

  if (paused) {
    handle.pushMessage("Continue.");
  } else {
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
  }
  pushFeedEvent({ sid, kind: "info", own: true, verb: "deleted by you" });
  pushSessionRemove(sid);
}

export function sendMessage(sid: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  getAgentSession(sid)?.pushMessage(trimmed);
}

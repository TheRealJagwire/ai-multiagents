import { findSession } from "./state.ts";
import { pushFeedEvent, pushSessionPatch } from "./mutations.ts";
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

// Stopping interrupts and closes the local Agent SDK process, then removes
// the session's git worktree (any uncommitted work is auto-committed first —
// see git-worktree.ts) while always keeping the branch. That's a real,
// irreversible cleanup step, so — same as before — this deliberately carries
// no undo rather than showing a misleading "Undo" link.
export function stopSession(sid: string): void {
  const session = findSession(sid);
  if (session.status === "stopped" || session.status === "done") return;

  pushSessionPatch(sid, { status: "stopped", statusLine: "Stopped by you", phase: "stopped" });
  pushFeedEvent({ sid, kind: "info", own: true, verb: "stopped by you" });

  const handle = getAgentSession(sid);
  if (!handle) return;
  unregisterAgentSession(sid);

  (async () => {
    await handle.query.interrupt().catch(() => {});
    handle.query.close();
    await removeWorktree(handle.dir, handle.worktreePath);
    pushFeedEvent({ sid, kind: "info", own: false, verb: `worktree removed — work saved on branch ${handle.branch}` });
  })().catch((err) => {
    pushFeedEvent({ sid, kind: "error", own: false, verb: `failed to clean up worktree: ${String(err)}` });
  });
}

export function sendMessage(sid: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  getAgentSession(sid)?.pushMessage(trimmed);
}

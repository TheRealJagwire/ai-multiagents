import type { ArtifactPreviewStyle } from "../../src/kraken/types.ts";
import { findEvent, findSession, state } from "./state.ts";
import { pushFeedEvent, pushSessionPatch, resolveEvent } from "./mutations.ts";

const PUBLISH_DELAY_MS = 6000;
const REVISION_DELAY_MS = 12000;

export function approveArtifact(id: string): void {
  const ev = findEvent(id);
  if (ev.resolved !== null) return;

  resolveEvent(id, "approved-art");
  const session = findSession(ev.sid);
  pushSessionPatch(ev.sid, {
    statusLine: "Notes approved — finalizing",
    msDone: Math.min(session.msTotal, session.msDone + 1),
  });
  pushFeedEvent({ sid: ev.sid, kind: "info", own: true, verb: `${ev.artName ?? "artifact"} approved by you` });

  setTimeout(() => {
    const current = findSession(ev.sid);
    pushSessionPatch(ev.sid, {
      status: "done",
      statusLine: "Done · notes published",
      phase: "done",
      msDone: current.msTotal,
    });
    pushFeedEvent({
      sid: ev.sid,
      kind: "info",
      own: false,
      verb: `published ${ev.artName ?? "the artifact"} — task complete`,
    });
  }, PUBLISH_DELAY_MS);
}

export function requestChanges(id: string, note: string): void {
  const ev = findEvent(id);
  if (ev.resolved !== null) return;

  const trimmedNote = note.trim();
  resolveEvent(id, "changes-req");
  pushSessionPatch(ev.sid, { statusLine: "Revising notes per your feedback", phase: "executing" });
  pushFeedEvent({
    sid: ev.sid,
    kind: "info",
    own: true,
    verb: `changes requested on ${ev.artName ?? "the draft"}${trimmedNote ? ` — "${trimmedNote}"` : ""}`,
  });

  setTimeout(() => {
    const draftNumber = state.events.filter((e) => e.sid === ev.sid && e.kind === "review").length + 1;
    const revisedPreview: [string, ArtifactPreviewStyle][] = (ev.artPreview ?? []).map((line, i, arr) =>
      i === arr.length - 1 ? [line[0], "c"] : line
    );
    revisedPreview.push(["▍ = changed since previous draft", "m"]);

    pushFeedEvent({
      sid: ev.sid,
      kind: "review",
      own: false,
      verb: `requests your review — draft v${draftNumber}`,
      artName: ev.artName,
      artExt: ev.artExt,
      artMeta: `Draft v${draftNumber} · revised`,
      why: `Revision addressing your feedback${trimmedNote ? `: "${trimmedNote}"` : ""}. Changed lines are highlighted.`,
      chipsV: [`Draft v${draftNumber}`],
      chipsC: [],
      artPreview: revisedPreview,
    });
    pushSessionPatch(ev.sid, { statusLine: `Draft v${draftNumber} ready for review`, phase: "reviewing" });
  }, REVISION_DELAY_MS);
}

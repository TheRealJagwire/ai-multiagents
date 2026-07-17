import { type Effort, type Model, providerOf, type Team } from "../../src/switchboard/types.ts";
import { findSession, state } from "./state.ts";
import { pushFeedEvent, pushSessionPatch, pushTeamsReplace } from "./mutations.ts";
import { deleteSession } from "./session-actions.ts";
import { getAgentSession } from "./agent-registry.ts";
// Both subsystems run in one process (main.ts mounts both apps) — a direct
// call avoids a self-HTTP round trip and mirrors kv.ts's existing import
// the other way (orchestration -> switchboard's appDataDir).
import { archiveBoard, resolveBoard } from "../orchestration/service.ts";
import { getKv } from "../orchestration/kv.ts";

const STEP_BOUNDARY_MS = 8000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(sid: string, kind: string): string {
  return `${sid}:${kind}`;
}

function clearTimer(sid: string, kind: string): void {
  const key = timerKey(sid, kind);
  const timer = timers.get(key);
  if (timer) {
    clearTimeout(timer);
    timers.delete(key);
  }
}

function setTimer(sid: string, kind: string, fn: () => void): void {
  clearTimer(sid, kind);
  timers.set(timerKey(sid, kind), setTimeout(fn, STEP_BOUNDARY_MS));
}

// The Claude Agent SDK's live Query exposes setModel() — unlike Managed
// Agents, a running session's model really can change mid-flight. Queue the
// change and apply it at the next step boundary (same UX/timer pattern as
// queueMove below) rather than switching immediately, so an in-flight turn
// finishes on the model it started with.
export function queueModelChange(sid: string, model: Model): void {
  const session = findSession(sid);
  if (session.status === "done" || session.status === "stopped") return;
  if (session.model === model) return;
  // A live session can't hop runtimes — the driver (Claude SDK vs ADK) was
  // chosen at spawn from the model's provider. The UI only offers
  // same-provider chips, but guard here too against stale clients.
  if (providerOf(session.model) !== providerOf(model)) {
    pushFeedEvent({ sid, kind: "error", own: false, verb: `can't switch a running session between providers (${session.model} → ${model})` });
    return;
  }

  pushSessionPatch(sid, { pendingModel: model });
  pushFeedEvent({ sid, kind: "info", own: true, verb: `model change queued: → ${model} at the next step boundary` });
  setTimer(sid, "model", () => executeModelChange(sid));
}

export function cancelPendingModel(sid: string): void {
  clearTimer(sid, "model");
  pushSessionPatch(sid, { pendingModel: null });
}

function executeModelChange(sid: string): void {
  const session = findSession(sid);
  const model = session.pendingModel;
  if (!model) return;
  clearTimer(sid, "model");

  const handle = getAgentSession(sid);
  if (!handle) {
    pushSessionPatch(sid, { pendingModel: null });
    return;
  }

  handle.setModel(model)
    .then(() => {
      pushSessionPatch(sid, { model, pendingModel: null });
      pushFeedEvent({ sid, kind: "info", own: false, verb: `model changed to ${model} at step boundary` });
    })
    .catch((err) => {
      pushSessionPatch(sid, { pendingModel: null });
      pushFeedEvent({ sid, kind: "error", own: false, verb: `failed to change model: ${String(err)}` });
    });
}

// Effort has no equivalent live-update method on the SDK's Query — only
// model does. Keep this a no-op (frontend disables the effort chips and
// explains why) rather than displaying a queued change that can never apply.
// deno-lint-ignore no-unused-vars
export function queueEffortChange(sid: string, effort: Effort): void {}

export function cancelPendingEffort(sid: string): void {
  clearTimer(sid, "effort");
  pushSessionPatch(sid, { pendingEffort: null });
}

export function queueMove(sid: string, target: string | null): void {
  const session = findSession(sid);
  if (session.status === "done" || session.status === "stopped") return;
  if (session.teamId === target) return;

  const targetTeam = target ? state.teams.find((t) => t.id === target) : undefined;
  const label = targetTeam ? targetTeam.name : "Independent";

  pushSessionPatch(sid, { pendingMove: { target, label } });
  pushFeedEvent({ sid, kind: "info", own: true, verb: `move queued: → ${label} at the next step boundary` });
  setTimer(sid, "move", () => executeMove(sid));
}

export function cancelMove(sid: string): void {
  clearTimer(sid, "move");
  pushSessionPatch(sid, { pendingMove: null });
}

export function executeMove(sid: string): void {
  const session = findSession(sid);
  if (!session.pendingMove) return;
  clearTimer(sid, "move");

  const target = session.pendingMove.target;
  if (session.teamId === target) {
    pushSessionPatch(sid, { pendingMove: null });
    return;
  }

  const fromTeamId = session.teamId;
  const fromTeam = fromTeamId ? state.teams.find((t) => t.id === fromTeamId) : undefined;
  const toTeam = target ? state.teams.find((t) => t.id === target) : undefined;
  const wasLead = session.lead;

  pushSessionPatch(sid, {
    teamId: target,
    lead: false,
    dep: "",
    pendingMove: null,
    name: target ? `Worker · ${session.baseName}` : session.baseName,
  });

  let extra = "";
  let heirId: string | undefined;
  if (fromTeamId) {
    const remaining = state.sessions.filter((s) => s.teamId === fromTeamId && s.id !== sid);
    if (remaining.length === 0) {
      pushTeamsReplace(state.teams.filter((t) => t.id !== fromTeamId));
      extra = ` — ${fromTeam?.name ?? "team"} disbanded (no members left)`;
    } else if (wasLead) {
      const heir = remaining[0];
      heirId = heir.id;
      pushSessionPatch(heir.id, { lead: true, name: `Lead · ${heir.baseName}` });
    }
  }

  pushFeedEvent({
    sid,
    kind: "info",
    own: false,
    verb: `${toTeam ? `handed off to ${toTeam.name}` : `detached from ${fromTeam?.name ?? "team"}`} at step boundary — context transferred${extra}`,
  });
  if (heirId) {
    pushFeedEvent({ sid: heirId, kind: "info", own: false, verb: `auto-promoted to lead of ${fromTeam?.name ?? "team"}` });
  }
}

export function makeLead(sid: string): void {
  const session = findSession(sid);
  if (!session.teamId) return;
  const teamId = session.teamId;
  const team = state.teams.find((t) => t.id === teamId);

  for (const s of state.sessions) {
    if (s.teamId !== teamId) continue;
    const isNewLead = s.id === sid;
    if (s.lead === isNewLead) continue;
    pushSessionPatch(s.id, { lead: isNewLead, name: `${isNewLead ? "Lead" : "Worker"} · ${s.baseName}` });
  }

  pushFeedEvent({
    sid,
    kind: "info",
    own: true,
    verb: `promoted to lead of ${team?.name ?? "team"} — takes over coordination at the next step`,
  });
}

// The orchestration server has no hard-delete for boards, only archive
// (read-only, hidden from board lists) — its whole design point is a
// durable audit trail, so this doesn't fight that: archiving is the
// correct "delete" here. Best-effort and async — a KV hiccup must never
// block or fail the team deletion that triggered it. Guards against a
// board shared by more than one team (nothing stops two teams pointing at
// the same slug) by only archiving once no *other* team still links it.
async function archiveBoardIfUnshared(boardSlug: string, remainingTeams: Team[], announceSid?: string): Promise<void> {
  if (remainingTeams.some((t) => t.boardSlug === boardSlug)) return;
  try {
    const kv = await getKv();
    const board = await resolveBoard(kv, boardSlug);
    if (!board || board.archivedAt) return;
    await archiveBoard(kv, board.id);
    if (announceSid) {
      pushFeedEvent({ sid: announceSid, kind: "info", own: false, verb: `board "${boardSlug}" archived — no other team links it` });
    }
  } catch (err) {
    if (announceSid) {
      pushFeedEvent({ sid: announceSid, kind: "error", own: false, verb: `failed to archive board "${boardSlug}": ${String(err)}` });
    }
  }
}

// Deletes every member session (same terminate-and-remove as deleteSession)
// before removing the team record itself — no undo, matching every other
// irreversible cleanup action in this app.
export function deleteTeam(teamId: string): void {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return;

  const members = state.sessions.filter((s) => s.teamId === teamId);
  const announceSid = members.find((s) => s.lead)?.id ?? members[0]?.id;
  if (announceSid) {
    pushFeedEvent({ sid: announceSid, kind: "info", own: true, verb: `team "${team.name}" deleted by you` });
  }

  for (const member of members) deleteSession(member.id);
  const remainingTeams = state.teams.filter((t) => t.id !== teamId);
  pushTeamsReplace(remainingTeams);

  if (team.boardSlug) {
    void archiveBoardIfUnshared(team.boardSlug, remainingTeams, announceSid);
  }
}

// Everything done to a single session or team from the UI: open/rename/
// stop/delete, chat, pause, queued model/effort/move changes, promotion.

import * as api from "../api.ts";
import {
  chatDrafts,
  confirmStop,
  deleteSessionConfirm,
  deleteTeamConfirm,
  expandedMemberId,
  moveConfirm,
  renameDraft,
  selectedSessionId,
  sessionsById,
  startWorkersConfirm,
  teams,
} from "../store.ts";
import type { Effort, Model } from "../types.ts";
import { modelLabel } from "../format.ts";
import { showErrorToast, showToast } from "./toasts.ts";

export function openSession(sid: string): void {
  selectedSessionId.value = sid;
  confirmStop.value = false;
  renameDraft.value = null;
}

export function closeSession(): void {
  selectedSessionId.value = null;
  confirmStop.value = false;
}

// --- Session rename (the name is the session's user-facing identity) ---

export function startRenameSession(currentBaseName: string): void {
  renameDraft.value = currentBaseName;
}

export function setRenameDraft(value: string): void {
  renameDraft.value = value;
}

export function cancelRenameSession(): void {
  renameDraft.value = null;
}

export async function commitRenameSession(sid: string): Promise<void> {
  const name = (renameDraft.value ?? "").trim();
  renameDraft.value = null;
  if (!name) return;
  try {
    await api.renameSession(sid, name);
  } catch (err) {
    showErrorToast("Couldn't rename session", err);
  }
}

export function askStop(): void {
  confirmStop.value = true;
}

export function cancelStop(): void {
  confirmStop.value = false;
}

export function setChatText(sid: string, text: string): void {
  chatDrafts.value = { ...chatDrafts.value, [sid]: text };
}

export function toggleManageExpanded(sid: string): void {
  expandedMemberId.value = expandedMemberId.value === sid ? null : sid;
  moveConfirm.value = null;
}

export function openMoveConfirm(sid: string, target: string | null): void {
  moveConfirm.value = { sid, target };
}

export function cancelMoveConfirm(): void {
  moveConfirm.value = null;
}

export async function togglePause(id: string): Promise<void> {
  try {
    await api.togglePause(id);
  } catch (err) {
    showErrorToast("Couldn't change pause state", err);
  }
}

export async function confirmStopSession(id: string): Promise<void> {
  // No undo callback: stopping now archives the real session, which has no
  // "unarchive" — matching session-actions.ts's stopSession, this stays
  // honestly irreversible instead of showing an Undo link that would lie.
  const session = sessionsById.value.get(id);
  try {
    await api.stopSession(id);
    if (session) showToast(`Stopped ${session.short}`);
    closeSession();
  } catch (err) {
    showErrorToast(`Couldn't stop${session ? ` ${session.short}` : ""}`, err);
  }
}

export function askDeleteSession(id: string): void {
  deleteSessionConfirm.value = id;
}

export function cancelDeleteSession(): void {
  deleteSessionConfirm.value = null;
}

// No undo, same reasoning as confirmStopSession — deleting also terminates
// the underlying process, and additionally removes the session from every
// list, so there's nothing left to restore even the honest way.
export async function confirmDeleteSession(id: string): Promise<void> {
  const session = sessionsById.value.get(id);
  deleteSessionConfirm.value = null;
  try {
    await api.deleteSession(id);
    if (session) showToast(`Deleted ${session.short}`);
    closeSession();
  } catch (err) {
    showErrorToast(`Couldn't delete${session ? ` ${session.short}` : ""}`, err);
  }
}

export function askDeleteTeam(id: string): void {
  deleteTeamConfirm.value = id;
}

export function cancelDeleteTeam(): void {
  deleteTeamConfirm.value = null;
}

export async function confirmDeleteTeam(id: string): Promise<void> {
  const team = teams.value.find((t) => t.id === id);
  deleteTeamConfirm.value = null;
  try {
    await api.deleteTeam(id);
    if (team) showToast(`Deleted ${team.name}`);
  } catch (err) {
    showErrorToast(`Couldn't delete${team ? ` ${team.name}` : ""}`, err);
  }
}

export function askStartWorkers(id: string): void {
  startWorkersConfirm.value = id;
}

export function cancelStartWorkers(): void {
  startWorkersConfirm.value = null;
}

export async function confirmStartWorkers(id: string): Promise<void> {
  const team = teams.value.find((t) => t.id === id);
  startWorkersConfirm.value = null;
  try {
    await api.startWorkers(id);
    if (team) showToast(`Starting workers for ${team.name}`);
  } catch (err) {
    showErrorToast(`Couldn't start workers${team ? ` for ${team.name}` : ""}`, err);
  }
}

export async function sendMessage(id: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  setChatText(id, "");
  try {
    await api.sendMessage(id, trimmed);
  } catch (err) {
    setChatText(id, text); // failed send — put the draft back rather than lose it
    showErrorToast("Couldn't send message", err);
  }
}

export async function cancelPendingModel(id: string): Promise<void> {
  try {
    await api.cancelPendingModel(id);
  } catch (err) {
    showErrorToast("Couldn't cancel model change", err);
  }
}

export async function cancelPendingEffort(id: string): Promise<void> {
  try {
    await api.cancelPendingEffort(id);
  } catch (err) {
    showErrorToast("Couldn't cancel effort change", err);
  }
}

export async function queueModelChange(id: string, model: Model): Promise<void> {
  const session = sessionsById.value.get(id);
  if (!session) {
    try {
      await api.queueModelChange(id, model);
    } catch (err) {
      showErrorToast("Couldn't queue model change", err);
    }
    return;
  }

  if (session.pendingModel === model || session.model === model) {
    return cancelPendingModel(id);
  }
  try {
    await api.queueModelChange(id, model);
    showToast(`Queued for ${session.short}: ${modelLabel(model)} at next step`, () => cancelPendingModel(id));
  } catch (err) {
    showErrorToast(`Couldn't queue model change for ${session.short}`, err);
  }
}

export async function queueEffortChange(id: string, effort: Effort): Promise<void> {
  const session = sessionsById.value.get(id);
  if (!session) {
    try {
      await api.queueEffortChange(id, effort);
    } catch (err) {
      showErrorToast("Couldn't queue effort change", err);
    }
    return;
  }

  if (session.pendingEffort === effort || session.effort === effort) {
    return cancelPendingEffort(id);
  }
  try {
    await api.queueEffortChange(id, effort);
    showToast(`Queued for ${session.short}: ${effort} effort at next step`, () => cancelPendingEffort(id));
  } catch (err) {
    showErrorToast(`Couldn't queue effort change for ${session.short}`, err);
  }
}

export async function cancelMove(id: string): Promise<void> {
  try {
    await api.cancelMove(id);
  } catch (err) {
    showErrorToast("Couldn't cancel move", err);
  }
}

export async function queueMove(sid: string, target: string | null): Promise<void> {
  const session = sessionsById.value.get(sid);
  moveConfirm.value = null;
  try {
    await api.queueMove(sid, target);
    if (session) {
      showToast(`Move queued for ${session.short} — hands off at next step`, () => cancelMove(sid));
    }
  } catch (err) {
    showErrorToast(`Couldn't queue move${session ? ` for ${session.short}` : ""}`, err);
  }
}

export async function makeLead(sid: string): Promise<void> {
  const session = sessionsById.value.get(sid);
  const previousLead = session?.teamId
    ? [...sessionsById.value.values()].find((s) => s.teamId === session.teamId && s.lead)
    : undefined;
  try {
    await api.makeLead(sid);
    if (session) {
      showToast(`Promoted ${session.short} to lead`, previousLead ? () => makeLead(previousLead.id) : undefined);
    }
  } catch (err) {
    showErrorToast(`Couldn't promote${session ? ` ${session.short}` : ""}`, err);
  }
}

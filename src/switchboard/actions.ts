import * as api from "./api.ts";
import {
  activeFilter,
  type ActivityFilter,
  activeTab,
  chatText,
  confirmStop,
  type DraftMember,
  digestDismissed,
  draftMembers,
  events,
  eventsById,
  expandedMemberId,
  feedWindowSize,
  grants,
  grantsOpen,
  lastSeen,
  memberEffort,
  memberModel,
  modalMode,
  modalOpen,
  moveConfirm,
  pinnedShowAll,
  promptText,
  reviewOpen,
  revComment,
  searchQuery,
  selectedSessionId,
  sessionFilter,
  sessions,
  sessionsById,
  spawnBaseRef,
  spawnDir,
  type SpawnMode,
  type Tab,
  targetTeamId,
  teamName,
  teams,
  toast,
  transcripts,
} from "./store.ts";
import type { Effort, FeedEvent, Grant, Model, Session, Snapshot, Team, TranscriptMessage } from "./types.ts";
import { modelLabel } from "./format.ts";

export function ingestSnapshot(snapshot: Snapshot): void {
  sessions.value = snapshot.sessions;
  teams.value = snapshot.teams;
  events.value = [...snapshot.events].sort((a, b) => b.ts - a.ts);
  grants.value = snapshot.grants;
  transcripts.value = snapshot.transcripts;
}

export function ingestFeedEvent(event: FeedEvent): void {
  events.value = [event, ...events.value];
}

export function patchSession(id: string, patch: Partial<Session>): void {
  sessions.value = sessions.value.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

export function patchEvent(id: string, patch: Partial<FeedEvent>): void {
  events.value = events.value.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

export function addGrant(grant: Grant): void {
  grants.value = [...grants.value, grant];
}

export function removeGrant(id: string): void {
  grants.value = grants.value.filter((g) => g.id !== id);
}

export function ingestTranscriptMessage(sid: string, message: TranscriptMessage): void {
  transcripts.value = { ...transcripts.value, [sid]: [...(transcripts.value[sid] ?? []), message] };
}

export function replaceTeams(nextTeams: Team[]): void {
  teams.value = nextTeams;
}

export function addSession(session: Session): void {
  sessions.value = [...sessions.value, session];
}

export function setFilter(filter: ActivityFilter): void {
  activeFilter.value = filter;
}

export function setSearchQuery(query: string): void {
  searchQuery.value = query;
}

export function setSessionFilter(sid: string | null): void {
  sessionFilter.value = sid;
}

export function togglePinnedShowAll(): void {
  pinnedShowAll.value = !pinnedShowAll.value;
}

export function expandFeedWindow(): void {
  feedWindowSize.value += 150;
}

export function markCaughtUp(): void {
  lastSeen.value = Date.now();
  digestDismissed.value = true;
  if (activeFilter.value === "unread") activeFilter.value = "all";
}

export function dismissDigest(): void {
  digestDismissed.value = true;
}

export function openSession(sid: string): void {
  selectedSessionId.value = sid;
  confirmStop.value = false;
  chatText.value = "";
}

export function closeSession(): void {
  selectedSessionId.value = null;
  confirmStop.value = false;
}

export function askStop(): void {
  confirmStop.value = true;
}

export function cancelStop(): void {
  confirmStop.value = false;
}

export function setChatText(text: string): void {
  chatText.value = text;
}

export function setActiveTab(tab: Tab): void {
  activeTab.value = tab;
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

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(label: string, undo?: () => void): void {
  clearTimeout(toastTimer);
  toast.value = { label, undo };
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 7000);
}

export function dismissToast(): void {
  clearTimeout(toastTimer);
  toast.value = null;
}

export function undoToast(): void {
  const undo = toast.value?.undo;
  clearTimeout(toastTimer);
  toast.value = null;
  undo?.();
}

export function openReview(id: string): void {
  reviewOpen.value = id;
  revComment.value = "";
}

export function closeReview(): void {
  reviewOpen.value = null;
  revComment.value = "";
}

export function setRevComment(text: string): void {
  revComment.value = text;
}

export function toggleGrantsPopover(): void {
  grantsOpen.value = !grantsOpen.value;
}

export function closeGrantsPopover(): void {
  grantsOpen.value = false;
}

// Network-triggered resolution actions — thin pass-throughs so components
// only ever import from actions.ts, never api.ts directly. The resulting
// state change arrives back over the SSE stream (patchEvent/patchSession
// above), not from these calls' return value.
export function approveEvent(id: string, scope: "once" | "session"): Promise<void> {
  const event = eventsById.value.get(id);
  const session = event ? sessionsById.value.get(event.sid) : undefined;
  if (session) showToast(`Approved ${session.short}`, () => api.undo(id));
  return api.approveEvent(id, scope);
}

export function denyEvent(id: string): Promise<void> {
  const event = eventsById.value.get(id);
  const session = event ? sessionsById.value.get(event.sid) : undefined;
  if (session) showToast(`Denied ${session.short}`, () => api.undo(id));
  return api.denyEvent(id);
}

export function retryEvent(id: string): Promise<void> {
  return api.retryEvent(id);
}

export function applyAltFix(id: string): Promise<void> {
  return api.applyAltFix(id);
}

export function togglePause(id: string): Promise<void> {
  return api.togglePause(id);
}

export async function confirmStopSession(id: string): Promise<void> {
  // No undo callback: stopping now archives the real session, which has no
  // "unarchive" — matching session-actions.ts's stopSession, this stays
  // honestly irreversible instead of showing an Undo link that would lie.
  const session = sessionsById.value.get(id);
  if (session) showToast(`Stopped ${session.short}`);
  await api.stopSession(id);
  closeSession();
}

export function sendMessage(id: string, text: string): Promise<void> {
  return api.sendMessage(id, text);
}

export function cancelPendingModel(id: string): Promise<void> {
  return api.cancelPendingModel(id);
}

export function cancelPendingEffort(id: string): Promise<void> {
  return api.cancelPendingEffort(id);
}

export function queueModelChange(id: string, model: Model): Promise<void> {
  const session = sessionsById.value.get(id);
  if (!session) return api.queueModelChange(id, model);

  if (session.pendingModel === model || session.model === model) {
    return cancelPendingModel(id);
  }
  showToast(`Queued for ${session.short}: ${modelLabel(model)} at next step`, () => cancelPendingModel(id));
  return api.queueModelChange(id, model);
}

export function queueEffortChange(id: string, effort: Effort): Promise<void> {
  const session = sessionsById.value.get(id);
  if (!session) return api.queueEffortChange(id, effort);

  if (session.pendingEffort === effort || session.effort === effort) {
    return cancelPendingEffort(id);
  }
  showToast(`Queued for ${session.short}: ${effort} effort at next step`, () => cancelPendingEffort(id));
  return api.queueEffortChange(id, effort);
}

export function cancelMove(id: string): Promise<void> {
  return api.cancelMove(id);
}

export function queueMove(sid: string, target: string | null): Promise<void> {
  const session = sessionsById.value.get(sid);
  moveConfirm.value = null;
  if (session) {
    showToast(`Move queued for ${session.short} — hands off at next step`, () => cancelMove(sid));
  }
  return api.queueMove(sid, target);
}

export function makeLead(sid: string): Promise<void> {
  const session = sessionsById.value.get(sid);
  const previousLead = session?.teamId
    ? [...sessionsById.value.values()].find((s) => s.teamId === session.teamId && s.lead)
    : undefined;
  if (session) {
    showToast(`Promoted ${session.short} to lead`, previousLead ? () => makeLead(previousLead.id) : undefined);
  }
  return api.makeLead(sid);
}

export async function approveArtifact(id: string): Promise<void> {
  await api.approveArtifact(id);
  closeReview();
}

export async function requestChanges(id: string): Promise<void> {
  await api.requestChanges(id, revComment.value);
  closeReview();
}

export function revokeGrant(id: string): Promise<void> {
  const grant = grants.value.find((g) => g.id === id);
  if (grant) showToast(`Revoked ${grant.pattern}`, () => api.undo(id));
  return api.revokeGrant(id);
}

function freshDraft(): DraftMember[] {
  return [
    { task: "", model: "opus", effort: "high" },
    { task: "", model: "sonnet", effort: "medium" },
  ];
}

export function openSpawnModal(mode: SpawnMode, teamId?: string): void {
  modalMode.value = mode;
  promptText.value = "";
  teamName.value = "";
  targetTeamId.value = teamId ?? teams.value[0]?.id ?? null;
  memberModel.value = "sonnet";
  memberEffort.value = "medium";
  draftMembers.value = mode === "new" ? freshDraft() : [];
  spawnDir.value = "";
  spawnBaseRef.value = "HEAD";
  modalOpen.value = true;
}

export function closeSpawnModal(): void {
  modalOpen.value = false;
}

export function setModalMode(mode: SpawnMode): void {
  modalMode.value = mode;
  if (mode === "new" && draftMembers.value.length === 0) draftMembers.value = freshDraft();
  if (!targetTeamId.value) targetTeamId.value = teams.value[0]?.id ?? null;
}

export function setTeamName(value: string): void {
  teamName.value = value;
}

export function setPromptText(value: string): void {
  promptText.value = value;
}

export function setTargetTeamId(id: string | null): void {
  targetTeamId.value = id;
}

export function setMemberModel(model: Model): void {
  memberModel.value = model;
}

export function setMemberEffort(effort: Effort): void {
  memberEffort.value = effort;
}

export function setSpawnDir(value: string): void {
  spawnDir.value = value;
}

export function setSpawnBaseRef(value: string): void {
  spawnBaseRef.value = value;
}

export function addDraftMember(): void {
  draftMembers.value = [...draftMembers.value, { task: "", model: "sonnet", effort: "medium" }];
}

export function removeDraftMember(index: number): void {
  if (draftMembers.value.length <= 1) return;
  draftMembers.value = draftMembers.value.filter((_, i) => i !== index);
}

export function setDraftMember(index: number, patch: Partial<DraftMember>): void {
  draftMembers.value = draftMembers.value.map((d, i) => (i === index ? { ...d, ...patch } : d));
}

export async function submitSpawn(): Promise<void> {
  const mode = modalMode.value;
  if (mode === "new") {
    await api.spawnSession({
      mode: "new",
      teamName: teamName.value,
      goal: promptText.value,
      dir: spawnDir.value,
      baseRef: spawnBaseRef.value,
      members: draftMembers.value,
    });
  } else if (mode === "existing") {
    await api.spawnSession({
      mode: "existing",
      task: promptText.value,
      model: memberModel.value,
      effort: memberEffort.value,
      teamId: targetTeamId.value,
    });
  } else {
    await api.spawnSession({
      mode: "solo",
      task: promptText.value,
      model: memberModel.value,
      effort: memberEffort.value,
      dir: spawnDir.value,
      baseRef: spawnBaseRef.value,
    });
  }
  closeSpawnModal();
}

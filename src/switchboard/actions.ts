import * as api from "./api.ts";
import {
  activeFilter,
  type ActivityFilter,
  activeTab,
  chatDrafts,
  confirmStop,
  connected,
  deleteSessionConfirm,
  deleteTeamConfirm,
  dirSuggestions,
  type DraftMember,
  digestDismissed,
  draftMembers,
  events,
  eventsById,
  expandedMemberId,
  feedWindowSize,
  grants,
  grantsOpen,
  keyboardHelpOpen,
  lastSeen,
  MAX_RECENT_DIRS,
  mcpConfigs,
  mcpDeleteConfirm,
  mcpEditingId,
  mcpFormArgsText,
  mcpFormCommand,
  mcpFormEnvText,
  mcpFormError,
  mcpFormHeadersText,
  mcpFormName,
  mcpFormTransport,
  mcpFormUrl,
  mcpModalOpen,
  memberEffort,
  memberModel,
  modalMode,
  modalOpen,
  moveConfirm,
  pinnedShowAll,
  promptText,
  RECENT_DIRS_KEY,
  recentDirs,
  reviewOpen,
  revComment,
  scheduleDeleteConfirm,
  scheduleError,
  scheduleMsgAt,
  scheduleMsgSessionId,
  scheduleMsgText,
  scheduleMsgValidationError,
  scheduledModalOpen,
  schedules,
  searchQuery,
  selectedSessionId,
  sessionFilter,
  sessions,
  sessionsById,
  spawnAutonomousLead,
  spawnBaseRef,
  spawnCreateNew,
  spawnDir,
  spawnError,
  spawnLeadPlans,
  spawnMcpConfigIds,
  type SpawnMode,
  spawnNoWorktree,
  type RecurrenceMode,
  spawnRecurrenceDays,
  spawnRecurrenceEvery,
  spawnRecurrenceMode,
  spawnRecurrenceUnit,
  spawnScheduleAt,
  spawnScheduleEnabled,
  spawnSubmitting,
  spawnValidationError,
  startWorkersConfirm,
  type Tab,
  targetTeamId,
  teamName,
  teams,
  theme,
  THEME_KEY,
  type ThemeMode,
  toasts,
  transcripts,
} from "./store.ts";
import type {
  Effort,
  FeedEvent,
  Grant,
  McpConfig,
  McpTransport,
  Model,
  RecurrenceUnit,
  Schedule,
  Session,
  Snapshot,
  Team,
  TranscriptMessage,
} from "./types.ts";
import { modelLabel } from "./format.ts";

export function ingestSnapshot(snapshot: Snapshot): void {
  sessions.value = snapshot.sessions;
  teams.value = snapshot.teams;
  events.value = [...snapshot.events].sort((a, b) => b.ts - a.ts);
  grants.value = snapshot.grants;
  transcripts.value = snapshot.transcripts;
  mcpConfigs.value = snapshot.mcpConfigs;
  schedules.value = snapshot.schedules;
}

// The snapshot is otherwise only ever fetched once at mount — after a real
// reconnect (not the initial "open" every EventSource fires on first
// connect), the SSE stream resumes on top of whatever state we last had,
// which is stale if the backend restarted meanwhile. Re-fetching here means
// a reconnect always lands on ground truth instead of silently drifting.
export async function handleConnectionChange(isConnected: boolean): Promise<void> {
  const wasDisconnected = !connected.value;
  connected.value = isConnected;
  if (isConnected && wasDisconnected) {
    ingestSnapshot(await api.fetchSnapshot());
  }
}

export function replaceMcpConfigs(configs: McpConfig[]): void {
  mcpConfigs.value = configs;
}

export function replaceSchedules(nextSchedules: Schedule[]): void {
  schedules.value = nextSchedules;
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

export function removeSessionLocally(id: string): void {
  sessions.value = sessions.value.filter((s) => s.id !== id);
  if (selectedSessionId.value === id) closeSession();
  if (deleteSessionConfirm.value === id) deleteSessionConfirm.value = null;
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

export function setChatText(sid: string, text: string): void {
  chatDrafts.value = { ...chatDrafts.value, [sid]: text };
}

export function setActiveTab(tab: Tab): void {
  activeTab.value = tab;
}

// Jumps to the Feed tab and expands the pinned block so every card that
// needs a decision is actually visible, not just the first two.
export function goToPinned(): void {
  activeTab.value = "feed";
  pinnedShowAll.value = true;
}

export function applyTheme(mode: ThemeMode): void {
  if (mode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
}

export function setTheme(mode: ThemeMode): void {
  theme.value = mode;
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
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

const MAX_TOASTS = 3;
const INFO_TOAST_MS = 5000;
const UNDO_TOAST_MS = 9000; // undo-bearing toasts get longer to notice/act on

let nextToastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function removeToast(id: number): void {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function showToast(label: string, undo?: () => void): void {
  const id = nextToastId++;
  // Cap the stack rather than let rapid actions pile up indefinitely — drop
  // the oldest (and its timer) to make room, same as any bounded queue.
  if (toasts.value.length >= MAX_TOASTS) {
    removeToast(toasts.value[0].id);
  }
  toasts.value = [...toasts.value, { id, label, undo }];
  toastTimers.set(id, setTimeout(() => removeToast(id), undo ? UNDO_TOAST_MS : INFO_TOAST_MS));
}

function errMsg(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "request failed";
}

function showErrorToast(label: string, err: unknown): void {
  showToast(`${label} — ${errMsg(err)}`);
}

export function dismissToast(id: number): void {
  removeToast(id);
}

export function undoToast(id: number): void {
  const undo = toasts.value.find((t) => t.id === id)?.undo;
  removeToast(id);
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

export function toggleKeyboardHelp(): void {
  keyboardHelpOpen.value = !keyboardHelpOpen.value;
}

export function closeKeyboardHelp(): void {
  keyboardHelpOpen.value = false;
}

// Network-triggered resolution actions — thin pass-throughs so components
// only ever import from actions.ts, never api.ts directly. The resulting
// state change arrives back over the SSE stream (patchEvent/patchSession
// above), not from these calls' return value. Each awaits its API call
// before showing a toast: a success toast only ever appears once the server
// has actually confirmed it, and a failure surfaces as an error toast
// instead of silently doing nothing.
export async function approveEvent(id: string, scope: "once" | "session"): Promise<void> {
  const event = eventsById.value.get(id);
  const session = event ? sessionsById.value.get(event.sid) : undefined;
  try {
    await api.approveEvent(id, scope);
    if (session) showToast(`Approved ${session.short}`, () => api.undo(id));
  } catch (err) {
    showErrorToast(`Couldn't approve${session ? ` ${session.short}` : ""}`, err);
  }
}

export async function denyEvent(id: string): Promise<void> {
  const event = eventsById.value.get(id);
  const session = event ? sessionsById.value.get(event.sid) : undefined;
  try {
    await api.denyEvent(id);
    if (session) showToast(`Denied ${session.short}`, () => api.undo(id));
  } catch (err) {
    showErrorToast(`Couldn't deny${session ? ` ${session.short}` : ""}`, err);
  }
}

export async function retryEvent(id: string): Promise<void> {
  try {
    await api.retryEvent(id);
  } catch (err) {
    showErrorToast("Couldn't retry", err);
  }
}

export async function applyAltFix(id: string): Promise<void> {
  try {
    await api.applyAltFix(id);
  } catch (err) {
    showErrorToast("Couldn't apply fix", err);
  }
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

export async function approveArtifact(id: string): Promise<void> {
  try {
    await api.approveArtifact(id);
    closeReview();
  } catch (err) {
    showErrorToast("Couldn't approve artifact", err);
  }
}

export async function requestChanges(id: string): Promise<void> {
  try {
    await api.requestChanges(id, revComment.value);
    closeReview();
  } catch (err) {
    showErrorToast("Couldn't request changes", err);
  }
}

export async function revokeGrant(id: string): Promise<void> {
  const grant = grants.value.find((g) => g.id === id);
  try {
    await api.revokeGrant(id);
    if (grant) showToast(`Revoked ${grant.pattern}`, () => api.undo(id));
  } catch (err) {
    showErrorToast("Couldn't revoke grant", err);
  }
}

function freshDraft(): DraftMember[] {
  return [
    { task: "", model: "opus", effort: "high" },
    { task: "", model: "sonnet", effort: "medium" },
  ];
}

// Full field reset — only ever called for a genuinely new task (switching
// which kind of thing you're spawning, or after a spawn actually succeeds).
// A stray Escape/backdrop-click close must never trigger this, or a long
// typed-out team goal gets silently thrown away.
function resetSpawnFields(mode: SpawnMode, teamId?: string): void {
  promptText.value = "";
  teamName.value = "";
  targetTeamId.value = teamId ?? teams.value[0]?.id ?? null;
  memberModel.value = "sonnet";
  memberEffort.value = "medium";
  draftMembers.value = mode === "new" ? freshDraft() : [];
  spawnDir.value = "";
  spawnBaseRef.value = "HEAD";
  spawnCreateNew.value = false;
  spawnNoWorktree.value = false;
  spawnMcpConfigIds.value = [];
  spawnLeadPlans.value = false;
  spawnAutonomousLead.value = false;
  spawnScheduleEnabled.value = false;
  spawnScheduleAt.value = "";
  spawnRecurrenceMode.value = "none";
  spawnRecurrenceEvery.value = 1;
  spawnRecurrenceUnit.value = "days";
  spawnRecurrenceDays.value = [];
  spawnError.value = null;
  dirSuggestions.value = [];
}

export function openSpawnModal(mode: SpawnMode, teamId?: string): void {
  // Re-opening in the same mode (e.g. after a stray dismiss) preserves
  // whatever was typed; only an actual mode switch resets the form.
  if (mode !== modalMode.value) resetSpawnFields(mode, teamId);
  modalMode.value = mode;
  if (teamId) targetTeamId.value = teamId;
  spawnError.value = null;
  dirSuggestions.value = [];
  modalOpen.value = true;
}

export function closeSpawnModal(): void {
  modalOpen.value = false;
}

export function setModalMode(mode: SpawnMode): void {
  if (mode !== modalMode.value) resetSpawnFields(mode);
  modalMode.value = mode;
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

let dirSuggestTimer: ReturnType<typeof setTimeout> | undefined;

export function setSpawnDir(value: string): void {
  spawnDir.value = value;

  clearTimeout(dirSuggestTimer);
  if (!value.trim().startsWith("/")) {
    dirSuggestions.value = [];
    return;
  }
  dirSuggestTimer = setTimeout(async () => {
    try {
      dirSuggestions.value = await api.listDirectories(value);
    } catch {
      dirSuggestions.value = [];
    }
  }, 200);
}

// One click instead of retyping a path from memory — used for both recent
// dirs and live autocomplete suggestions.
export function pickSpawnDir(dir: string): void {
  spawnDir.value = dir;
  dirSuggestions.value = [];
}

function rememberRecentDir(dir: string): void {
  const trimmed = dir.trim();
  if (!trimmed) return;
  const next = [trimmed, ...recentDirs.value.filter((d) => d !== trimmed)].slice(0, MAX_RECENT_DIRS);
  recentDirs.value = next;
  try {
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(next));
  } catch {
    // localStorage can be unavailable (e.g. restricted webview storage) —
    // losing the recent-dirs convenience isn't worth failing the spawn over.
  }
}

export function setSpawnBaseRef(value: string): void {
  spawnBaseRef.value = value;
}

export function setSpawnCreateNew(value: boolean): void {
  spawnCreateNew.value = value;
}

// Skipping git/worktrees is incompatible with the fields that only make
// sense when a worktree exists — creating a fresh repo just to not branch
// off it, or a lead planning teammates that get spawned onto their own
// branches — so checking this also clears those instead of leaving a
// contradictory combination the backend would have to silently resolve.
export function setSpawnNoWorktree(value: boolean): void {
  spawnNoWorktree.value = value;
  if (value) {
    spawnCreateNew.value = false;
    spawnLeadPlans.value = false;
    spawnAutonomousLead.value = false;
  }
}

export function setSpawnLeadPlans(value: boolean): void {
  spawnLeadPlans.value = value;
  if (!value) spawnAutonomousLead.value = false;
}

export function setSpawnAutonomousLead(value: boolean): void {
  spawnAutonomousLead.value = value;
}

export function setSpawnScheduleEnabled(value: boolean): void {
  spawnScheduleEnabled.value = value;
}

export function setSpawnScheduleAt(value: string): void {
  spawnScheduleAt.value = value;
}

export function setSpawnRecurrenceMode(mode: RecurrenceMode): void {
  spawnRecurrenceMode.value = mode;
}

export function setSpawnRecurrenceEvery(value: number): void {
  spawnRecurrenceEvery.value = value;
}

export function setSpawnRecurrenceUnit(unit: RecurrenceUnit): void {
  spawnRecurrenceUnit.value = unit;
}

export function toggleSpawnRecurrenceDay(day: number): void {
  spawnRecurrenceDays.value = spawnRecurrenceDays.value.includes(day)
    ? spawnRecurrenceDays.value.filter((d) => d !== day)
    : [...spawnRecurrenceDays.value, day].sort();
}

export function toggleSpawnMcpConfig(id: string): void {
  spawnMcpConfigIds.value = spawnMcpConfigIds.value.includes(id)
    ? spawnMcpConfigIds.value.filter((c) => c !== id)
    : [...spawnMcpConfigIds.value, id];
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
  const validationError = spawnValidationError.value;
  if (validationError) {
    spawnError.value = validationError;
    return;
  }

  spawnError.value = null;
  spawnSubmitting.value = true;
  try {
    if (mode === "existing") {
      await api.spawnSession({
        mode: "existing",
        task: promptText.value,
        model: memberModel.value,
        effort: memberEffort.value,
        teamId: targetTeamId.value,
      });
    } else {
      const body = mode === "new"
        ? (() => {
          const coordination = !spawnLeadPlans.value ? "classic" : (spawnAutonomousLead.value ? "autonomous" : "sequenced");
          // In lead-plans mode only the lead's row (index 0) is meaningful —
          // the rest of the team is determined by the lead, not typed in here.
          const members = coordination === "classic" ? draftMembers.value : draftMembers.value.slice(0, 1);
          return {
            mode: "new",
            teamName: teamName.value,
            goal: promptText.value,
            dir: spawnDir.value,
            baseRef: spawnBaseRef.value,
            createNew: spawnCreateNew.value,
            useWorktree: !spawnNoWorktree.value,
            coordination,
            mcpConfigIds: spawnMcpConfigIds.value,
            members,
          };
        })()
        : {
          mode: "solo",
          task: promptText.value,
          model: memberModel.value,
          effort: memberEffort.value,
          dir: spawnDir.value,
          baseRef: spawnBaseRef.value,
          createNew: spawnCreateNew.value,
          useWorktree: !spawnNoWorktree.value,
          mcpConfigIds: spawnMcpConfigIds.value,
        };

      if (spawnScheduleEnabled.value) {
        const label = mode === "new" ? `Team: ${teamName.value.trim()}` : `Session: ${promptText.value.trim().slice(0, 60)}`;
        const scheduledAt = new Date(spawnScheduleAt.value);
        const recurrence = spawnRecurrenceMode.value === "interval"
          ? { kind: "interval", unit: spawnRecurrenceUnit.value, every: spawnRecurrenceEvery.value }
          : spawnRecurrenceMode.value === "weekly"
          ? {
            kind: "weekly",
            daysOfWeek: spawnRecurrenceDays.value,
            hour: scheduledAt.getHours(),
            minute: scheduledAt.getMinutes(),
          }
          : null;
        await api.createSchedule({
          label,
          runAt: scheduledAt.getTime(),
          payload: { kind: "spawn", body },
          recurrence,
        });
      } else {
        await api.spawnSession(body);
      }
    }
    if (mode !== "existing") rememberRecentDir(spawnDir.value);
    // Only a successful spawn resets the form and closes the modal — a
    // failed request keeps everything as typed so the user can fix and retry.
    resetSpawnFields(mode);
    closeSpawnModal();
  } catch (err) {
    spawnError.value = errMsg(err);
  } finally {
    spawnSubmitting.value = false;
  }
}

// KEY=VALUE per line — good enough for the small env/header sets a personal
// desktop app's config forms realistically need, no reason to build a
// dynamic add/remove-row UI for this.
function parseKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function serializeKeyValueLines(record: Record<string, string>): string {
  return Object.entries(record).map(([k, v]) => `${k}=${v}`).join("\n");
}

function resetMcpForm(): void {
  mcpFormName.value = "";
  mcpFormTransport.value = "stdio";
  mcpFormCommand.value = "";
  mcpFormArgsText.value = "";
  mcpFormEnvText.value = "";
  mcpFormUrl.value = "";
  mcpFormHeadersText.value = "";
  mcpEditingId.value = null;
}

export function openMcpModal(): void {
  resetMcpForm();
  mcpModalOpen.value = true;
}

export function closeMcpModal(): void {
  mcpModalOpen.value = false;
}

// Pre-fills the form from an existing config so editing doesn't mean
// delete-and-retype-everything.
export function startEditMcpConfig(config: McpConfig): void {
  mcpEditingId.value = config.id;
  mcpFormName.value = config.name;
  mcpFormTransport.value = config.transport;
  mcpFormCommand.value = config.command;
  mcpFormArgsText.value = config.args.join(" ");
  mcpFormEnvText.value = serializeKeyValueLines(config.env);
  mcpFormUrl.value = config.url;
  mcpFormHeadersText.value = serializeKeyValueLines(config.headers);
}

export function cancelEditMcpConfig(): void {
  resetMcpForm();
}

export function setMcpFormName(value: string): void {
  mcpFormName.value = value;
}

export function setMcpFormTransport(value: McpTransport): void {
  mcpFormTransport.value = value;
}

export function setMcpFormCommand(value: string): void {
  mcpFormCommand.value = value;
}

export function setMcpFormArgsText(value: string): void {
  mcpFormArgsText.value = value;
}

export function setMcpFormEnvText(value: string): void {
  mcpFormEnvText.value = value;
}

export function setMcpFormUrl(value: string): void {
  mcpFormUrl.value = value;
}

export function setMcpFormHeadersText(value: string): void {
  mcpFormHeadersText.value = value;
}

export async function submitMcpConfig(): Promise<void> {
  if (mcpFormError.value) return;

  const body = {
    name: mcpFormName.value,
    transport: mcpFormTransport.value,
    command: mcpFormCommand.value,
    args: mcpFormArgsText.value.split(/\s+/).filter(Boolean),
    env: parseKeyValueLines(mcpFormEnvText.value),
    url: mcpFormUrl.value,
    headers: parseKeyValueLines(mcpFormHeadersText.value),
  };

  const editingId = mcpEditingId.value;
  try {
    if (editingId) {
      await api.updateMcpConfig(editingId, body);
    } else {
      await api.addMcpConfig(body);
    }
    resetMcpForm();
  } catch (err) {
    showErrorToast(editingId ? "Couldn't update MCP server" : "Couldn't add MCP server", err);
  }
}

export function askDeleteMcpConfig(id: string): void {
  mcpDeleteConfirm.value = id;
}

export function cancelDeleteMcpConfig(): void {
  mcpDeleteConfirm.value = null;
}

export async function confirmDeleteMcpConfig(id: string): Promise<void> {
  mcpDeleteConfirm.value = null;
  spawnMcpConfigIds.value = spawnMcpConfigIds.value.filter((c) => c !== id);
  try {
    await api.deleteMcpConfig(id);
  } catch (err) {
    showErrorToast("Couldn't delete MCP server", err);
  }
}

function resetScheduleMsgForm(): void {
  scheduleMsgSessionId.value = sessions.value.find((s) => s.status !== "done" && s.status !== "stopped")?.id ?? null;
  scheduleMsgText.value = "";
  scheduleMsgAt.value = "";
  scheduleError.value = null;
}

export function openScheduledModal(): void {
  resetScheduleMsgForm();
  scheduledModalOpen.value = true;
}

export function closeScheduledModal(): void {
  scheduledModalOpen.value = false;
  scheduleDeleteConfirm.value = null;
}

export function setScheduleMsgSessionId(id: string | null): void {
  scheduleMsgSessionId.value = id;
}

export function setScheduleMsgText(value: string): void {
  scheduleMsgText.value = value;
}

export function setScheduleMsgAt(value: string): void {
  scheduleMsgAt.value = value;
}

export async function submitScheduleMessage(): Promise<void> {
  if (scheduleMsgValidationError.value) return;
  const sessionId = scheduleMsgSessionId.value!;
  const session = sessionsById.value.get(sessionId);
  const text = scheduleMsgText.value.trim();
  scheduleError.value = null;
  try {
    await api.createSchedule({
      label: `Message to ${session?.name ?? sessionId}: ${text.slice(0, 60)}`,
      runAt: new Date(scheduleMsgAt.value).getTime(),
      payload: { kind: "message", sessionId, text },
    });
    resetScheduleMsgForm();
  } catch (err) {
    scheduleError.value = errMsg(err);
  }
}

export function askDeleteSchedule(id: string): void {
  scheduleDeleteConfirm.value = id;
}

export function cancelDeleteSchedule(): void {
  scheduleDeleteConfirm.value = null;
}

export async function confirmDeleteSchedule(id: string): Promise<void> {
  scheduleDeleteConfirm.value = null;
  try {
    await api.deleteSchedule(id);
  } catch (err) {
    showErrorToast("Couldn't delete schedule", err);
  }
}

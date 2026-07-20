// The spawn modal: form state transitions, directory autocomplete, and the
// submit that turns the form into a spawn (or a scheduled spawn).

import * as api from "../api.ts";
import {
  activeTab,
  defaultDirectory,
  dirSuggestions,
  type DraftMember,
  initialSpawnForm,
  MAX_RECENT_DIRS,
  modalMode,
  modalOpen,
  patchForm,
  RECENT_DIRS_KEY,
  recentDirs,
  spawnError,
  spawnForm,
  type SpawnForm,
  type SpawnMode,
  spawnSubmitting,
  spawnValidationError,
  teams,
} from "../store.ts";
import { errMsg } from "./toasts.ts";

function freshDraft(): DraftMember[] {
  return [
    { task: "", model: "opus", effort: "high", name: "" },
    { task: "", model: "sonnet", effort: "medium", name: "" },
  ];
}

// Full field reset — only ever called for a genuinely new task (switching
// which kind of thing you're spawning, or after a spawn actually succeeds).
// A stray Escape/backdrop-click close must never trigger this, or a long
// typed-out team goal gets silently thrown away.
function resetSpawnFields(mode: SpawnMode, teamId?: string): void {
  spawnForm.value = {
    ...initialSpawnForm(),
    targetTeamId: teamId ?? teams.value[0]?.id ?? null,
    draftMembers: mode === "new" ? freshDraft() : [],
  };
  spawnError.value = null;
  dirSuggestions.value = [];
}

export function openSpawnModal(mode: SpawnMode, teamId?: string): void {
  // Re-opening in the same mode (e.g. after a stray dismiss) preserves
  // whatever was typed; only an actual mode switch resets the form.
  if (mode !== modalMode.value) resetSpawnFields(mode, teamId);
  modalMode.value = mode;
  if (teamId) patchForm(spawnForm, { targetTeamId: teamId });
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
  if (!spawnForm.value.targetTeamId) patchForm(spawnForm, { targetTeamId: teams.value[0]?.id ?? null });
}

// The one setter every plain field shares — components patch the form
// directly with the field they own instead of one exported setter per field.
export function setSpawnField(patch: Partial<SpawnForm>): void {
  patchForm(spawnForm, patch);
}

let dirSuggestTimer: ReturnType<typeof setTimeout> | undefined;

export function setSpawnDir(value: string): void {
  patchForm(spawnForm, { dir: value });

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
  patchForm(spawnForm, { dir });
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

// Skipping git/worktrees is incompatible with the fields that only make
// sense when a worktree exists — creating a fresh repo just to not branch
// off it, or a lead planning teammates that get spawned onto their own
// branches — so checking this also clears those instead of leaving a
// contradictory combination the backend would have to silently resolve.
export function setSpawnNoWorktree(value: boolean): void {
  patchForm(
    spawnForm,
    value ? { noWorktree: true, createNew: false, leadPlans: false, autonomousLead: false } : { noWorktree: false },
  );
}

export function setSpawnLeadPlans(value: boolean): void {
  patchForm(spawnForm, value ? { leadPlans: true } : { leadPlans: false, autonomousLead: false });
}

export function toggleSpawnRecurrenceDay(day: number): void {
  const days = spawnForm.value.recurrenceDays;
  patchForm(spawnForm, {
    recurrenceDays: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort(),
  });
}

export function toggleSpawnMcpConfig(id: string): void {
  const ids = spawnForm.value.mcpConfigIds;
  patchForm(spawnForm, { mcpConfigIds: ids.includes(id) ? ids.filter((c) => c !== id) : [...ids, id] });
}

export function addDraftMember(): void {
  patchForm(spawnForm, {
    draftMembers: [...spawnForm.value.draftMembers, { task: "", model: "sonnet", effort: "medium", name: "" }],
  });
}

export function removeDraftMember(index: number): void {
  if (spawnForm.value.draftMembers.length <= 1) return;
  patchForm(spawnForm, { draftMembers: spawnForm.value.draftMembers.filter((_, i) => i !== index) });
}

export function setDraftMember(index: number, patch: Partial<DraftMember>): void {
  patchForm(spawnForm, {
    draftMembers: spawnForm.value.draftMembers.map((d, i) => (i === index ? { ...d, ...patch } : d)),
  });
}

export async function submitSpawn(): Promise<void> {
  const mode = modalMode.value;
  const form = spawnForm.value;
  const validationError = spawnValidationError.value;
  if (validationError) {
    spawnError.value = validationError;
    return;
  }

  const dir = form.useDefaultDir ? (defaultDirectory.value ?? "") : form.dir;

  spawnError.value = null;
  spawnSubmitting.value = true;
  try {
    if (mode === "existing") {
      await api.spawnSession({
        mode: "existing",
        task: form.promptText,
        model: form.memberModel,
        effort: form.memberEffort,
        teamId: form.targetTeamId,
        name: form.sessionName.trim() || undefined,
      });
    } else {
      const body = mode === "new"
        ? (() => {
          const coordination = !form.leadPlans ? "classic" : (form.autonomousLead ? "autonomous" : "sequenced");
          // In lead-plans mode only the lead's row (index 0) is meaningful —
          // the rest of the team is determined by the lead, not typed in here.
          const members = coordination === "classic" ? form.draftMembers : form.draftMembers.slice(0, 1);
          return {
            mode: "new",
            teamName: form.teamName,
            goal: form.promptText,
            dir,
            baseRef: form.baseRef,
            createNew: form.createNew,
            useWorktree: !form.noWorktree,
            coordination,
            mcpConfigIds: form.mcpConfigIds,
            members,
            boardSlug: form.boardSlug.trim() || undefined,
            planFirst: form.planFirst,
          };
        })()
        : {
          mode: "solo",
          name: form.sessionName.trim() || undefined,
          task: form.promptText,
          model: form.memberModel,
          effort: form.memberEffort,
          dir,
          baseRef: form.baseRef,
          createNew: form.createNew,
          useWorktree: !form.noWorktree,
          mcpConfigIds: form.mcpConfigIds,
          planFirst: form.planFirst,
        };

      if (form.scheduleEnabled) {
        const label = mode === "new" ? `Team: ${form.teamName.trim()}` : `Session: ${form.promptText.trim().slice(0, 60)}`;
        const scheduledAt = new Date(form.scheduleAt);
        const recurrence = form.recurrenceMode === "interval"
          ? { kind: "interval", unit: form.recurrenceUnit, every: form.recurrenceEvery }
          : form.recurrenceMode === "weekly"
          ? {
            kind: "weekly",
            daysOfWeek: form.recurrenceDays,
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
    if (mode !== "existing") rememberRecentDir(form.dir);
    // A freshly created team is where the action is about to happen —
    // land the user on the Teams tab so they see it come up. (Scheduled
    // spawns fire later with no one at the wheel, so they don't steal
    // focus; joining an existing team doesn't either.)
    if (mode === "new" && !form.scheduleEnabled) activeTab.value = "teams";
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

// The Scheduled-items modal: the pending list plus the schedule-a-message
// form. (Scheduling a new session/team lives in spawn.ts with the rest of
// the spawn form.)

import * as api from "../api.ts";
import {
  initialScheduleMsgForm,
  patchForm,
  scheduleDeleteConfirm,
  scheduledModalOpen,
  scheduleError,
  scheduleMsgForm,
  type ScheduleMsgForm,
  scheduleMsgValidationError,
  sessions,
  sessionsById,
} from "../store.ts";
import { errMsg, showErrorToast } from "./toasts.ts";

function resetScheduleMsgForm(): void {
  scheduleMsgForm.value = {
    ...initialScheduleMsgForm(),
    sessionId: sessions.value.find((s) => s.status !== "done" && s.status !== "stopped")?.id ?? null,
  };
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

export function setScheduleMsgField(patch: Partial<ScheduleMsgForm>): void {
  patchForm(scheduleMsgForm, patch);
}

export async function submitScheduleMessage(): Promise<void> {
  if (scheduleMsgValidationError.value) return;
  const form = scheduleMsgForm.value;
  const sessionId = form.sessionId!;
  const session = sessionsById.value.get(sessionId);
  const text = form.text.trim();
  scheduleError.value = null;
  try {
    await api.createSchedule({
      label: `Message to ${session?.name ?? sessionId}: ${text.slice(0, 60)}`,
      runAt: new Date(form.at).getTime(),
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

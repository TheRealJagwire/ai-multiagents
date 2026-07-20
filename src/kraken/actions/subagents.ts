// Subagent presets (Settings › Subagents).

import * as api from "../api.ts";
import { initialSubagentForm, patchForm, subagentDeleteConfirm, subagentForm, type SubagentForm } from "../store.ts";
import type { SubagentPreset } from "../types.ts";
import { showErrorToast } from "./toasts.ts";

export function resetSubagentForm(): void {
  subagentForm.value = initialSubagentForm();
}

export function setSubagentField(patch: Partial<SubagentForm>): void {
  patchForm(subagentForm, patch);
}

export function startEditSubagent(subagent: SubagentPreset): void {
  subagentForm.value = {
    editingId: subagent.id,
    name: subagent.name,
    description: subagent.description,
    prompt: subagent.systemPrompt,
    model: subagent.model,
    effort: subagent.effort,
  };
}

export function cancelEditSubagent(): void {
  resetSubagentForm();
}

export async function submitSubagent(): Promise<void> {
  const form = subagentForm.value;
  if (!form.name.trim()) return;
  const body = {
    name: form.name,
    description: form.description,
    systemPrompt: form.prompt,
    model: form.model,
    effort: form.effort,
  };
  const editingId = form.editingId;
  try {
    if (editingId) await api.updateSubagent(editingId, body);
    else await api.addSubagent(body);
    resetSubagentForm();
  } catch (err) {
    showErrorToast(editingId ? "Couldn't update subagent" : "Couldn't add subagent", err);
  }
}

export function askDeleteSubagent(id: string): void {
  subagentDeleteConfirm.value = id;
}

export function cancelDeleteSubagent(): void {
  subagentDeleteConfirm.value = null;
}

export async function confirmDeleteSubagent(id: string): Promise<void> {
  subagentDeleteConfirm.value = null;
  try {
    await api.deleteSubagent(id);
  } catch (err) {
    showErrorToast("Couldn't delete subagent", err);
  }
}

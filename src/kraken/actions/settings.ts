// The Settings modal and its General section: API keys, the default
// directory, and the catch-up-missed-schedules toggle.

import * as api from "../api.ts";
import {
  apiKeyForm,
  catchUpMissedSchedules,
  defaultDirectory,
  defaultDirForm,
  geminiKeyForm,
  initialSettingsDraft,
  patchForm,
  type SettingsDraft,
  settingsSection,
  type SettingsSection,
} from "../store.ts";
import type { Signal } from "@preact/signals";
import { showErrorToast, showToast } from "./toasts.ts";
import { resetMcpForm } from "./mcp.ts";
import { resetSkillForm } from "./skills.ts";
import { resetSubagentForm } from "./subagents.ts";

export function openSettingsSection(section: SettingsSection): void {
  apiKeyForm.value = initialSettingsDraft();
  geminiKeyForm.value = initialSettingsDraft();
  // Not a secret — prefill with the current value so editing means
  // "change this", not "retype it from scratch".
  defaultDirForm.value = { ...initialSettingsDraft(), draft: defaultDirectory.value ?? "" };
  // Every section opens with clean forms, never an abandoned half-edit.
  resetMcpForm();
  resetSkillForm();
  resetSubagentForm();
  settingsSection.value = section;
}

export function closeSettingsModal(): void {
  settingsSection.value = null;
  // Never keep key material around after the modal closes.
  apiKeyForm.value = initialSettingsDraft();
  geminiKeyForm.value = initialSettingsDraft();
  patchForm(defaultDirForm, { error: null });
}

export function setApiKeyDraft(value: string): void {
  patchForm(apiKeyForm, { draft: value });
}

export function setGeminiKeyDraft(value: string): void {
  patchForm(geminiKeyForm, { draft: value });
}

export function setDefaultDirDraft(value: string): void {
  patchForm(defaultDirForm, { draft: value });
}

// Shared submit shape for every settings save: mark saving, clear the error,
// run the request, park the failure message in the form.
async function runSave(form: Signal<SettingsDraft>, save: () => Promise<void>): Promise<void> {
  patchForm(form, { saving: true, error: null });
  try {
    await save();
  } catch (err) {
    patchForm(form, { error: err instanceof Error ? err.message : String(err) });
  } finally {
    patchForm(form, { saving: false });
  }
}

export function saveApiKey(): Promise<void> {
  return runSave(apiKeyForm, async () => {
    await api.setApiKey(apiKeyForm.value.draft);
    patchForm(apiKeyForm, { draft: "" });
    showToast("API key saved — applies to newly spawned sessions");
  });
}

export function clearApiKey(): Promise<void> {
  return runSave(apiKeyForm, async () => {
    await api.clearApiKey();
    showToast("API key removed — sessions fall back to claude login");
  });
}

export function saveGeminiKey(): Promise<void> {
  return runSave(geminiKeyForm, async () => {
    await api.setGeminiKey(geminiKeyForm.value.draft);
    patchForm(geminiKeyForm, { draft: "" });
    showToast("Gemini API key saved — applies to newly spawned sessions");
  });
}

export function clearGeminiKey(): Promise<void> {
  return runSave(geminiKeyForm, async () => {
    await api.clearGeminiKey();
    showToast("Gemini API key removed");
  });
}

export async function saveDefaultDirectory(): Promise<void> {
  const trimmed = defaultDirForm.value.draft.trim();
  if (trimmed && !trimmed.startsWith("/")) {
    patchForm(defaultDirForm, { error: "Directory must be an absolute path (starting with /)" });
    return;
  }
  await runSave(defaultDirForm, async () => {
    await api.setDefaultDirectory(trimmed);
    showToast(trimmed ? "Default directory saved" : "Default directory cleared");
  });
}

export async function clearDefaultDirectory(): Promise<void> {
  patchForm(defaultDirForm, { draft: "" });
  await saveDefaultDirectory();
}

export async function setCatchUpMissedSchedules(value: boolean): Promise<void> {
  const previous = catchUpMissedSchedules.value;
  catchUpMissedSchedules.value = value;
  try {
    await api.setCatchUpMissedSchedules(value);
  } catch (err) {
    catchUpMissedSchedules.value = previous;
    showErrorToast("Couldn't update setting", err);
  }
}

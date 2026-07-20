// The skills library (Settings › Skills).

import * as api from "../api.ts";
import { initialSkillForm, patchForm, skillDeleteConfirm, skillForm, type SkillForm } from "../store.ts";
import type { Skill } from "../types.ts";
import { showErrorToast } from "./toasts.ts";

export function resetSkillForm(): void {
  skillForm.value = initialSkillForm();
}

export function setSkillField(patch: Partial<SkillForm>): void {
  patchForm(skillForm, patch);
}

export function startEditSkill(skill: Skill): void {
  skillForm.value = {
    editingId: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
  };
}

export function cancelEditSkill(): void {
  resetSkillForm();
}

export async function submitSkill(): Promise<void> {
  const form = skillForm.value;
  if (!form.name.trim()) return;
  const body = {
    name: form.name,
    description: form.description,
    instructions: form.instructions,
  };
  const editingId = form.editingId;
  try {
    if (editingId) await api.updateSkill(editingId, body);
    else await api.addSkill(body);
    resetSkillForm();
  } catch (err) {
    showErrorToast(editingId ? "Couldn't update skill" : "Couldn't add skill", err);
  }
}

export function askDeleteSkill(id: string): void {
  skillDeleteConfirm.value = id;
}

export function cancelDeleteSkill(): void {
  skillDeleteConfirm.value = null;
}

export async function confirmDeleteSkill(id: string): Promise<void> {
  skillDeleteConfirm.value = null;
  try {
    await api.deleteSkill(id);
  } catch (err) {
    showErrorToast("Couldn't delete skill", err);
  }
}

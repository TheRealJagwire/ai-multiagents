// CRUD for the two spawn-adjacent libraries managed in Settings: skills
// (reusable instruction snippets) and subagent presets (named system
// prompt + model/effort). Same shape as mcp-actions.ts: ids minted here,
// every mutation through the push*Replace seam. Neither library is
// consumed at spawn time yet — the settings UI ships ahead of the wiring,
// so these are pure library management for now.

import type { Effort, Model, Skill, SubagentPreset } from "../../src/kraken/types.ts";
import { nextId, state } from "./state.ts";
import { pushSkillsReplace, pushSubagentsReplace } from "./mutations.ts";

export interface SkillInput {
  name: string;
  description: string;
  instructions: string;
}

export function addSkill(input: SkillInput): Skill {
  const skill: Skill = {
    id: nextId("sk"),
    name: input.name.trim() || "Unnamed skill",
    description: input.description.trim(),
    instructions: input.instructions.trim(),
  };
  pushSkillsReplace([...state.skills, skill]);
  return skill;
}

export function updateSkill(id: string, input: SkillInput): Skill | null {
  const existing = state.skills.find((s) => s.id === id);
  if (!existing) return null;
  const updated: Skill = {
    id,
    name: input.name.trim() || "Unnamed skill",
    description: input.description.trim(),
    instructions: input.instructions.trim(),
  };
  pushSkillsReplace(state.skills.map((s) => (s.id === id ? updated : s)));
  return updated;
}

export function deleteSkill(id: string): void {
  pushSkillsReplace(state.skills.filter((s) => s.id !== id));
}

export interface SubagentInput {
  name: string;
  description: string;
  systemPrompt: string;
  model: Model;
  effort: Effort;
}

export function addSubagent(input: SubagentInput): SubagentPreset {
  const subagent: SubagentPreset = {
    id: nextId("sub"),
    name: input.name.trim() || "Unnamed subagent",
    description: input.description.trim(),
    systemPrompt: input.systemPrompt.trim(),
    model: input.model,
    effort: input.effort,
  };
  pushSubagentsReplace([...state.subagents, subagent]);
  return subagent;
}

export function updateSubagent(id: string, input: SubagentInput): SubagentPreset | null {
  const existing = state.subagents.find((s) => s.id === id);
  if (!existing) return null;
  const updated: SubagentPreset = {
    id,
    name: input.name.trim() || "Unnamed subagent",
    description: input.description.trim(),
    systemPrompt: input.systemPrompt.trim(),
    model: input.model,
    effort: input.effort,
  };
  pushSubagentsReplace(state.subagents.map((s) => (s.id === id ? updated : s)));
  return updated;
}

export function deleteSubagent(id: string): void {
  pushSubagentsReplace(state.subagents.filter((s) => s.id !== id));
}

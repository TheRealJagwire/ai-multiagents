// The MCP server library (Settings › MCP servers).

import * as api from "../api.ts";
import { initialMcpForm, mcpDeleteConfirm, mcpForm, type McpForm, mcpFormError, patchForm, spawnForm } from "../store.ts";
import type { McpConfig } from "../types.ts";
import { showErrorToast } from "./toasts.ts";

// KEY=VALUE per line — good enough for the small env/header sets a personal
// desktop app's config forms realistically need, no reason to build a
// dynamic add/remove-row UI for this.
export function parseKeyValueLines(text: string): Record<string, string> {
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

export function resetMcpForm(): void {
  mcpForm.value = initialMcpForm();
}

export function setMcpField(patch: Partial<McpForm>): void {
  patchForm(mcpForm, patch);
}

// Pre-fills the form from an existing config so editing doesn't mean
// delete-and-retype-everything.
export function startEditMcpConfig(config: McpConfig): void {
  mcpForm.value = {
    editingId: config.id,
    name: config.name,
    transport: config.transport,
    command: config.command,
    argsText: config.args.join(" "),
    envText: serializeKeyValueLines(config.env),
    url: config.url,
    headersText: serializeKeyValueLines(config.headers),
  };
}

export function cancelEditMcpConfig(): void {
  resetMcpForm();
}

export async function submitMcpConfig(): Promise<void> {
  if (mcpFormError.value) return;

  const form = mcpForm.value;
  const body = {
    name: form.name,
    transport: form.transport,
    command: form.command,
    args: form.argsText.split(/\s+/).filter(Boolean),
    env: parseKeyValueLines(form.envText),
    url: form.url,
    headers: parseKeyValueLines(form.headersText),
  };

  const editingId = form.editingId;
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
  // A config selected in the spawn form must not survive its own deletion.
  patchForm(spawnForm, { mcpConfigIds: spawnForm.value.mcpConfigIds.filter((c) => c !== id) });
  try {
    await api.deleteMcpConfig(id);
  } catch (err) {
    showErrorToast("Couldn't delete MCP server", err);
  }
}

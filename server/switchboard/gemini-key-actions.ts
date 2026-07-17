// In-app Gemini API key management for ADK-driven sessions — the mirror of
// api-key-actions.ts (see there for the full rationale of the env-based
// mechanism). One ADK-specific difference: the key is ALSO read directly
// from settings at session-spawn time (adk-sessions.ts passes it explicitly
// to the Gemini model constructor), so the env var here is belt-and-braces
// for anything inside @google/genai that only looks at the environment.
// Runs at startup before any ADK import executes, in case the package
// captures env at import time.

import { loadSettingsFromDisk, updateSettings } from "./settings-store.ts";
import { pushGeminiKeyStatusReplace } from "./mutations.ts";
import { state } from "./state.ts";

const ENV_VAR = "GEMINI_API_KEY";

function tailOf(key: string): string {
  return key.slice(-4);
}

export async function initGeminiApiKey(): Promise<void> {
  const settings = await loadSettingsFromDisk();
  if (settings.geminiApiKey) {
    Deno.env.set(ENV_VAR, settings.geminiApiKey);
    state.geminiKeyConfigured = true;
    state.geminiKeyTail = tailOf(settings.geminiApiKey);
  } else {
    state.geminiKeyConfigured = false;
    state.geminiKeyTail = null;
  }
}

// The stored key, for handing explicitly to the ADK model constructor at
// spawn time. Server-side only — never crosses into a snapshot.
export async function getGeminiApiKey(): Promise<string | undefined> {
  return (await loadSettingsFromDisk()).geminiApiKey;
}

export async function setGeminiApiKey(key: string): Promise<{ error: string } | null> {
  const trimmed = key.trim();
  if (!trimmed) return { error: "API key is required" };
  // Shape check only — AIza is the documented Google API key prefix. Same
  // warning-grade gate as the Anthropic key: no live probe on save.
  if (!trimmed.startsWith("AIza")) return { error: 'That does not look like a Gemini API key (expected an "AIza…" value)' };
  await updateSettings({ geminiApiKey: trimmed });
  Deno.env.set(ENV_VAR, trimmed);
  pushGeminiKeyStatusReplace(true, tailOf(trimmed));
  return null;
}

export async function clearGeminiApiKey(): Promise<void> {
  await updateSettings({ geminiApiKey: undefined });
  Deno.env.delete(ENV_VAR);
  pushGeminiKeyStatusReplace(false, null);
}

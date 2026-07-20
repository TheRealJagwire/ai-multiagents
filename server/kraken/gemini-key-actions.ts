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
  // Google issues Gemini keys in more than one shape — classic AI-Studio
  // "AIza…" keys and newer "AQ.…" keys both authenticate (the latter
  // verified live 2026-07-17). So the only sanity check worth making is
  // catching an obvious wrong-box paste of an Anthropic key; anything else
  // is left for the first real spawn to surface as a session error.
  if (trimmed.startsWith("sk-ant-")) return { error: "That looks like an Anthropic key — paste it in the Anthropic field instead." };
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

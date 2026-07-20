// In-app Anthropic API key management. The mechanism is deliberately
// simple: the key is set into THIS server process's environment
// (Deno.env), and every `claude` CLI subprocess the Agent SDK spawns
// afterward inherits it — no SDK plumbing needed (the SDK's own `env`
// option REPLACES the subprocess environment wholesale, which is a
// footgun). Consequences worth knowing:
//   - Applies to sessions spawned after the change; already-running
//     subprocesses keep the env they were born with.
//   - Without a stored key, sessions fall back to whatever the server
//     inherited: a `claude login` credential or an external
//     ANTHROPIC_API_KEY. A stored key takes precedence at startup — an
//     explicit in-app choice beats ambient environment.
// The full key never leaves the server: state carries only a configured
// flag and a display tail.

import { loadSettingsFromDisk, updateSettings } from "./settings-store.ts";
import { pushApiKeyStatusReplace } from "./mutations.ts";
import { state } from "./state.ts";

const ENV_VAR = "ANTHROPIC_API_KEY";

function tailOf(key: string): string {
  return key.slice(-4);
}

// Runs at startup (routes.ts, before the server accepts requests) so the
// first GET /snapshot already reports the right status and the first
// spawn already has the key in its environment.
export async function initApiKey(): Promise<void> {
  const settings = await loadSettingsFromDisk();
  if (settings.anthropicApiKey) {
    Deno.env.set(ENV_VAR, settings.anthropicApiKey);
    state.apiKeyConfigured = true;
    state.apiKeyTail = tailOf(settings.anthropicApiKey);
  } else {
    state.apiKeyConfigured = false;
    state.apiKeyTail = null;
  }
}

export async function setAnthropicApiKey(key: string): Promise<{ error: string } | null> {
  const trimmed = key.trim();
  if (!trimmed) return { error: "API key is required" };
  // Shape check only — sk-ant- is the documented prefix. Deliberately a
  // warning-grade gate (not a live API probe): validating by spending
  // tokens on every save is worse than letting the first spawn surface a
  // bad key as a session error.
  if (!trimmed.startsWith("sk-ant-")) return { error: 'That does not look like an Anthropic API key (expected an "sk-ant-…" value)' };
  await updateSettings({ anthropicApiKey: trimmed });
  Deno.env.set(ENV_VAR, trimmed);
  pushApiKeyStatusReplace(true, tailOf(trimmed));
  return null;
}

export async function clearAnthropicApiKey(): Promise<void> {
  await updateSettings({ anthropicApiKey: undefined });
  Deno.env.delete(ENV_VAR);
  pushApiKeyStatusReplace(false, null);
}

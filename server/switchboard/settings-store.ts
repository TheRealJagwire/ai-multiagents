// Persists small app-level preferences that need to survive a restart and
// be readable before the scheduler decides how to handle missed schedules
// (see schedule-actions.ts's initSchedules). Deliberately its own tiny file
// rather than folded into schedules.json — schedules and settings are
// conceptually unrelated, and keeping them separate means a corrupt/missing
// one never affects the other.

import { dirname, join } from "jsr:@std/path";
import { appDataDir } from "./app-data-dir.ts";

export interface PersistedSettings {
  catchUpMissedSchedules: boolean;
  // Set from the in-app settings menu. Optional — absent means "use
  // whatever the environment provides" (claude login, or an inherited
  // ANTHROPIC_API_KEY). Stored plaintext in the app-data dir with 0600
  // file permissions; never sent to the frontend (only a configured
  // flag + tail for display — see api-key-actions.ts).
  anthropicApiKey?: string;
  // An absolute path the spawn flow can opt into instead of typing one out
  // each time (see general-settings-actions.ts). Not a secret — unlike the
  // API key, this is sent to the frontend as-is.
  defaultDirectory?: string;
}

const DEFAULT_SETTINGS: PersistedSettings = { catchUpMissedSchedules: false };

export const SETTINGS_FILE = join(appDataDir(), "settings.json");

export async function loadSettingsFromDisk(): Promise<PersistedSettings> {
  try {
    const text = await Deno.readTextFile(SETTINGS_FILE);
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
    const v = parsed as Record<string, unknown>;
    return {
      catchUpMissedSchedules: typeof v.catchUpMissedSchedules === "boolean"
        ? v.catchUpMissedSchedules
        : DEFAULT_SETTINGS.catchUpMissedSchedules,
      ...(typeof v.anthropicApiKey === "string" && v.anthropicApiKey.length > 0
        ? { anthropicApiKey: v.anthropicApiKey }
        : {}),
      ...(typeof v.defaultDirectory === "string" && v.defaultDirectory.length > 0
        ? { defaultDirectory: v.defaultDirectory }
        : {}),
    };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return DEFAULT_SETTINGS;
    console.error(`[settings] failed to load ${SETTINGS_FILE}:`, err);
    return DEFAULT_SETTINGS;
  }
}

async function writeNow(settings: PersistedSettings): Promise<void> {
  await Deno.mkdir(dirname(SETTINGS_FILE), { recursive: true });
  const tmpFile = `${SETTINGS_FILE}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmpFile, JSON.stringify(settings, null, 2));
  // The file can hold an API key — owner-only before it lands at its
  // final path. Windows has no POSIX modes; best-effort there.
  try {
    await Deno.chmod(tmpFile, 0o600);
  } catch {
    // chmod unsupported on this platform — proceed.
  }
  await Deno.rename(tmpFile, SETTINGS_FILE);
}

// Same write-serialization as schedule-store.ts — see there for why
// unserialized concurrent writes to the same file are unsafe.
let writeChain: Promise<void> = Promise.resolve();

// Read-modify-write for a single field, serialized on the same write chain
// so two concurrent updates can't lose each other's fields. Callers that
// used to save a whole hand-built object would silently wipe every field
// they didn't know about (e.g. toggling catch-up erasing a stored API key)
// — always go through this for partial updates. Pass `undefined` for a key
// to delete it.
export function updateSettings(partial: Partial<PersistedSettings>): Promise<void> {
  const task = writeChain.then(async () => {
    const current = await loadSettingsFromDisk();
    const merged: PersistedSettings = { ...current, ...partial };
    for (const [key, value] of Object.entries(partial)) {
      if (value === undefined) delete merged[key as keyof PersistedSettings];
    }
    await writeNow(merged);
  });
  writeChain = task.catch((err) => {
    console.error(`[settings] failed to update ${SETTINGS_FILE}:`, err);
  });
  return task;
}

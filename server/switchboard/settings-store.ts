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
  await Deno.rename(tmpFile, SETTINGS_FILE);
}

// Same write-serialization as schedule-store.ts — see there for why
// unserialized concurrent writes to the same file are unsafe.
let writeChain: Promise<void> = Promise.resolve();

export function saveSettingsToDisk(settings: PersistedSettings): Promise<void> {
  const task = writeChain.then(() => writeNow(settings));
  writeChain = task.catch((err) => {
    console.error(`[settings] failed to save ${SETTINGS_FILE}:`, err);
  });
  return task;
}

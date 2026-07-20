// Shared by schedule-store.ts and settings-store.ts — one source of truth
// for where kraken's on-disk state lives, so the two never drift onto
// different paths.

import { dirname, join } from "jsr:@std/path";

// The app was called Switchboard before it was Kraken, and existing installs
// have their state (state.json, schedules, API keys, the orchestration KV)
// under the old directory name. Runs once per process, before anything opens
// a file under the new path: if the new dir doesn't exist but the legacy one
// does, the legacy dir is renamed wholesale. A failed rename (permissions,
// cross-volume symlink) falls through to a fresh empty dir rather than
// blocking startup — the legacy data stays intact where it was.
let migrated = false;

function migrateLegacyDir(newDir: string): void {
  if (migrated) return;
  migrated = true;
  const legacyDir = join(dirname(newDir), "switchboard");
  try {
    Deno.statSync(newDir);
    return; // new dir already exists — nothing to migrate
  } catch {
    // fall through: new dir absent
  }
  try {
    Deno.statSync(legacyDir);
  } catch {
    return; // no legacy dir either — fresh install
  }
  try {
    Deno.renameSync(legacyDir, newDir);
    console.error(`[data] migrated app data: ${legacyDir} -> ${newDir}`);
  } catch (err) {
    console.error(`[data] could not migrate ${legacyDir} to ${newDir}:`, err);
  }
}

export function appDataDir(): string {
  // Tests (and anyone sandboxing the app) point this somewhere disposable —
  // without it, a test run would read/write the real user's app data.
  const override = Deno.env.get("KRAKEN_DATA_DIR");
  if (override) return override;
  const os = Deno.build.os;
  let dir: string;
  if (os === "darwin") {
    dir = join(Deno.env.get("HOME") ?? ".", "Library", "Application Support", "kraken");
  } else if (os === "windows") {
    dir = join(Deno.env.get("APPDATA") ?? Deno.env.get("HOME") ?? ".", "kraken");
  } else {
    const xdgData = Deno.env.get("XDG_DATA_HOME") ?? join(Deno.env.get("HOME") ?? ".", ".local", "share");
    dir = join(xdgData, "kraken");
  }
  migrateLegacyDir(dir);
  return dir;
}

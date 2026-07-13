// Shared by schedule-store.ts and settings-store.ts — one source of truth
// for where switchboard's on-disk state lives, so the two never drift onto
// different paths.

import { join } from "jsr:@std/path";

export function appDataDir(): string {
  // Tests (and anyone sandboxing the app) point this somewhere disposable —
  // without it, a test run would read/write the real user's app data.
  const override = Deno.env.get("SWITCHBOARD_DATA_DIR");
  if (override) return override;
  const os = Deno.build.os;
  if (os === "darwin") {
    return join(Deno.env.get("HOME") ?? ".", "Library", "Application Support", "switchboard");
  }
  if (os === "windows") {
    return join(Deno.env.get("APPDATA") ?? Deno.env.get("HOME") ?? ".", "switchboard");
  }
  const xdgData = Deno.env.get("XDG_DATA_HOME") ?? join(Deno.env.get("HOME") ?? ".", ".local", "share");
  return join(xdgData, "switchboard");
}

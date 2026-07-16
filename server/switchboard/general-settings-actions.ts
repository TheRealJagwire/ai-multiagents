// Small, non-secret app-level preferences that don't warrant their own
// dedicated action file (see schedule-actions.ts's catch-up setting and
// api-key-actions.ts for the pattern this mirrors). Currently just the
// spawn flow's default directory.

import { loadSettingsFromDisk, updateSettings } from "./settings-store.ts";
import { pushDefaultDirectoryReplace } from "./mutations.ts";

// Runs at startup (routes.ts, before the server accepts requests) so the
// first GET /snapshot already reports the persisted value.
export async function initDefaultDirectory(): Promise<void> {
  const settings = await loadSettingsFromDisk();
  pushDefaultDirectoryReplace(settings.defaultDirectory ?? null);
}

export function setDefaultDirectory(value: string): void {
  const trimmed = value.trim();
  pushDefaultDirectoryReplace(trimmed || null);
  // Partial update, not a whole-object save — settings.json also holds
  // fields this module doesn't own (e.g. the in-app API key).
  void updateSettings({ defaultDirectory: trimmed || undefined });
}

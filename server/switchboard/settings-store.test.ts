import { afterEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";

// SETTINGS_FILE binds to appDataDir() at import time, so the override must
// be in place before the module loads — hence the dynamic import.
const dataDir = await Deno.makeTempDir({ prefix: "sb-settings-test-" });
Deno.env.set("SWITCHBOARD_DATA_DIR", dataDir);
const { loadSettingsFromDisk, updateSettings, SETTINGS_FILE } = await import("./settings-store.ts");

afterEach(async () => {
  try {
    await Deno.remove(SETTINGS_FILE);
  } catch {
    // already absent
  }
});

describe("settings-store", () => {
  it("returns defaults when no file exists", async () => {
    const settings = await loadSettingsFromDisk();
    assertEquals(settings, { catchUpMissedSchedules: false });
  });

  it("returns defaults when the file is malformed", async () => {
    await Deno.writeTextFile(SETTINGS_FILE, "{not json");
    const settings = await loadSettingsFromDisk();
    assertEquals(settings, { catchUpMissedSchedules: false });
  });

  it("round-trips a partial update", async () => {
    await updateSettings({ catchUpMissedSchedules: true });
    assertEquals((await loadSettingsFromDisk()).catchUpMissedSchedules, true);
  });

  // The regression that motivated updateSettings: saving one field as a
  // whole hand-built object used to wipe every other stored field.
  it("a partial update preserves fields it does not mention", async () => {
    await updateSettings({ anthropicApiKey: "sk-ant-test-1234" });
    await updateSettings({ catchUpMissedSchedules: true });
    const settings = await loadSettingsFromDisk();
    assertEquals(settings.anthropicApiKey, "sk-ant-test-1234");
    assertEquals(settings.catchUpMissedSchedules, true);
  });

  it("passing undefined deletes a stored key", async () => {
    await updateSettings({ anthropicApiKey: "sk-ant-test-1234" });
    await updateSettings({ anthropicApiKey: undefined });
    const settings = await loadSettingsFromDisk();
    assertEquals(settings.anthropicApiKey, undefined);
    assert(!(await Deno.readTextFile(SETTINGS_FILE)).includes("sk-ant"), "key material gone from disk");
  });

  it("concurrent updates serialize on the write chain — neither is lost", async () => {
    await Promise.all([
      updateSettings({ anthropicApiKey: "sk-ant-test-5678" }),
      updateSettings({ catchUpMissedSchedules: true }),
    ]);
    const settings = await loadSettingsFromDisk();
    assertEquals(settings.anthropicApiKey, "sk-ant-test-5678");
    assertEquals(settings.catchUpMissedSchedules, true);
  });

  it("writes the file owner-only (0600) on POSIX", async () => {
    if (Deno.build.os === "windows") return; // no POSIX modes there
    await updateSettings({ anthropicApiKey: "sk-ant-test-perm" });
    const info = await Deno.stat(SETTINGS_FILE);
    assertEquals(info.mode! & 0o777, 0o600);
  });

  it("round-trips a default directory alongside other fields", async () => {
    await updateSettings({ anthropicApiKey: "sk-ant-test-dir" });
    await updateSettings({ defaultDirectory: "/repo/project" });
    const settings = await loadSettingsFromDisk();
    assertEquals(settings.defaultDirectory, "/repo/project");
    assertEquals(settings.anthropicApiKey, "sk-ant-test-dir");
  });

  it("clearing the default directory removes the key entirely", async () => {
    await updateSettings({ defaultDirectory: "/repo/project" });
    await updateSettings({ defaultDirectory: undefined });
    const settings = await loadSettingsFromDisk();
    assertEquals(settings.defaultDirectory, undefined);
  });
});

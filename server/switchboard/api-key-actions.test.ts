import { afterAll, beforeAll, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";

Deno.env.set("SWITCHBOARD_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-apikey-test-" }));
const { initApiKey, setAnthropicApiKey, clearAnthropicApiKey } = await import("./api-key-actions.ts");
const { loadSettingsFromDisk } = await import("./settings-store.ts");
const { state } = await import("./state.ts");

// The test process may inherit a real ANTHROPIC_API_KEY from the shell —
// stash it so assertions see only what the module under test did.
const originalKey = Deno.env.get("ANTHROPIC_API_KEY");

beforeAll(() => {
  Deno.env.delete("ANTHROPIC_API_KEY");
});

afterAll(() => {
  if (originalKey === undefined) Deno.env.delete("ANTHROPIC_API_KEY");
  else Deno.env.set("ANTHROPIC_API_KEY", originalKey);
});

describe("api-key-actions", () => {
  it("rejects an empty key", async () => {
    const result = await setAnthropicApiKey("   ");
    assert(result !== null && result.error.includes("required"));
    assertEquals(Deno.env.get("ANTHROPIC_API_KEY"), undefined);
  });

  it("rejects a key without the sk-ant- prefix, leaving env and state untouched", async () => {
    const result = await setAnthropicApiKey("sk-openai-oops");
    assert(result !== null);
    assertEquals(Deno.env.get("ANTHROPIC_API_KEY"), undefined);
    assertEquals(state.apiKeyConfigured, false);
  });

  it("accepts a well-formed key: env set, status fields set, disk updated", async () => {
    const result = await setAnthropicApiKey("  sk-ant-test-abcd  ");
    assertEquals(result, null);
    assertEquals(Deno.env.get("ANTHROPIC_API_KEY"), "sk-ant-test-abcd", "trimmed before use");
    assertEquals(state.apiKeyConfigured, true);
    assertEquals(state.apiKeyTail, "abcd");
    assertEquals((await loadSettingsFromDisk()).anthropicApiKey, "sk-ant-test-abcd");
  });

  it("initApiKey applies a stored key at startup", async () => {
    await setAnthropicApiKey("sk-ant-test-wxyz");
    Deno.env.delete("ANTHROPIC_API_KEY");
    state.apiKeyConfigured = false;
    state.apiKeyTail = null;

    await initApiKey();
    assertEquals(Deno.env.get("ANTHROPIC_API_KEY"), "sk-ant-test-wxyz");
    assertEquals(state.apiKeyConfigured, true);
    assertEquals(state.apiKeyTail, "wxyz");
  });

  it("clear removes the key from env, state, and disk", async () => {
    await setAnthropicApiKey("sk-ant-test-gone");
    await clearAnthropicApiKey();
    assertEquals(Deno.env.get("ANTHROPIC_API_KEY"), undefined);
    assertEquals(state.apiKeyConfigured, false);
    assertEquals(state.apiKeyTail, null);
    assertEquals((await loadSettingsFromDisk()).anthropicApiKey, undefined);

    // And a subsequent boot stays unconfigured.
    await initApiKey();
    assertEquals(state.apiKeyConfigured, false);
  });
});

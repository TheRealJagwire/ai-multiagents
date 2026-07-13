import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import type { BusMessage } from "./bus.ts";

// mutations.ts imports state-store, whose STATE_FILE binds at import time.
Deno.env.set("SWITCHBOARD_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-mutations-test-" }));
const mutations = await import("./mutations.ts");
const { subscribe } = await import("./bus.ts");
const { state, setIdCounter } = await import("./state.ts");
const { STATE_FILE } = await import("./state-store.ts");

let received: BusMessage[];
let unsubscribe: () => void;

beforeEach(() => {
  state.sessions = [];
  state.teams = [];
  state.events = [];
  state.grants = [];
  state.transcripts = {};
  state.mcpConfigs = [];
  setIdCounter(0);
  received = [];
  unsubscribe = subscribe((message) => received.push(message));
});

afterEach(async () => {
  unsubscribe();
  // Let any pending debounced persist flush so the timer sanitizer is
  // satisfied and no write lands mid-way through the next test.
  await new Promise((r) => setTimeout(r, 500));
  try {
    await Deno.remove(STATE_FILE);
  } catch {
    // absent — fine
  }
});

function lastMessage(): BusMessage {
  assert(received.length > 0, "expected at least one bus message");
  return received[received.length - 1];
}

describe("mutations publish the right topic and mutate state", () => {
  it("pushFeedEvent prepends (newest first) and publishes feed-event", () => {
    const event = mutations.pushFeedEvent({ sid: "s-1", kind: "info", verb: "first", own: false });
    mutations.pushFeedEvent({ sid: "s-1", kind: "error", verb: "second", own: false });

    assertEquals(state.events.length, 2);
    assertEquals(state.events[0].verb, "second", "newest first");
    assertEquals(event.resolved, null);
    assertEquals(received[0], { event: "feed-event", data: state.events[1] });
  });

  it("resolveEvent patches the event and publishes event-patch", () => {
    const event = mutations.pushFeedEvent({ sid: "s-1", kind: "approval", verb: "wants to run", own: false });
    mutations.resolveEvent(event.id, "approved");

    assertEquals(state.events[0].resolved, "approved");
    assertEquals(lastMessage(), { event: "event-patch", data: { id: event.id, patch: { resolved: "approved" } } });
  });

  it("grant add/remove/restore round-trips state and topics", () => {
    const grant = mutations.addGrant("s-1", "git *");
    assertEquals(lastMessage().event, "grant-added");
    assertEquals(state.grants, [grant]);

    mutations.removeGrant(grant.id);
    assertEquals(lastMessage(), { event: "grant-revoked", data: { id: grant.id } });
    assertEquals(state.grants, []);

    mutations.restoreGrant(grant);
    assertEquals(lastMessage().event, "grant-added");
    assertEquals(state.grants, [grant]);
  });

  it("pushTranscriptMessage appends per-session and publishes transcript-message", () => {
    mutations.pushTranscriptMessage("s-1", { k: "text", text: "hello" });
    mutations.pushTranscriptMessage("s-1", { k: "note", text: "aside" });
    mutations.pushTranscriptMessage("s-2", { k: "text", text: "other" });

    assertEquals(state.transcripts["s-1"].length, 2);
    assertEquals(state.transcripts["s-2"].length, 1);
    assertEquals(lastMessage(), { event: "transcript-message", data: { sid: "s-2", message: { k: "text", text: "other" } } });
  });

  it("pushTranscriptRemove drops the session's transcript and publishes transcript-removed", () => {
    mutations.pushTranscriptMessage("s-1", { k: "text", text: "hello" });
    mutations.pushTranscriptRemove("s-1");

    assertEquals(state.transcripts["s-1"], undefined);
    assertEquals(lastMessage(), { event: "transcript-removed", data: { sid: "s-1" } });

    // Removing an absent transcript is a silent no-op — no phantom event.
    const before = received.length;
    mutations.pushTranscriptRemove("never-existed");
    assertEquals(received.length, before);
  });

  it("the in-memory feed is capped — old events fall off the end", () => {
    for (let i = 0; i < 2010; i++) {
      mutations.pushFeedEvent({ sid: "s-1", kind: "info", verb: `event ${i}`, own: false });
    }
    assertEquals(state.events.length, 2000);
    assertEquals(state.events[0].verb, "event 2009", "newest kept");
    assertEquals(state.events.at(-1)?.verb, "event 10", "oldest dropped");
  });

  it("pushApiKeyStatusReplace carries status only — never key material", () => {
    mutations.pushApiKeyStatusReplace(true, "abcd");
    assertEquals(state.apiKeyConfigured, true);
    assertEquals(state.apiKeyTail, "abcd");
    assertEquals(lastMessage(), { event: "api-key-status-replaced", data: { configured: true, tail: "abcd" } });
  });

  it("a mutation burst coalesces into one debounced state.json write with the final state", async () => {
    for (let i = 0; i < 5; i++) {
      mutations.pushFeedEvent({ sid: "s-1", kind: "info", verb: `burst ${i}`, own: false });
    }
    // Debounce is 400ms: shortly after the burst nothing has landed yet…
    await new Promise((r) => setTimeout(r, 150));
    let existsEarly = true;
    try {
      await Deno.stat(STATE_FILE);
    } catch {
      existsEarly = false;
    }
    assertEquals(existsEarly, false, "write must be debounced, not immediate");

    // …and once it flushes, the file holds the whole burst.
    await new Promise((r) => setTimeout(r, 600));
    const onDisk = JSON.parse(await Deno.readTextFile(STATE_FILE));
    assertEquals(onDisk.events.length, 5);
    assertEquals(onDisk.events[0].verb, "burst 4");
  });
});

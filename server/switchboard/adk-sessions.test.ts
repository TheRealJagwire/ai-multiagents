import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import type { Session } from "../../src/switchboard/types.ts";

// adk-sessions transitively imports state-store (file paths bind at import
// time) — isolate before loading, same pattern as agent-sessions.test.ts.
Deno.env.set("SWITCHBOARD_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-adk-msg-test-" }));
const { translateAdkEvent } = await import("./adk-sessions.ts");
const { flushTurnSummary } = await import("./turn-report.ts");
const { state, setIdCounter } = await import("./state.ts");

function makeSession(id: string): Session {
  return {
    id,
    name: id,
    short: id,
    baseName: id,
    teamId: null,
    lead: false,
    status: "running",
    statusLine: "",
    phase: "executing",
    msDone: 0,
    msTotal: 4,
    startedAt: 0,
    cost: 0,
    model: "gemini-flash",
    effort: "medium",
    ctx: 1,
    dep: "",
    pendingModel: null,
    pendingEffort: null,
    pendingMove: null,
    dir: "/repo",
    worktreePath: null,
    branch: null,
    useWorktree: true,
    mcpConfigIds: [],
  };
}

beforeEach(() => {
  state.sessions = [makeSession("s-1")];
  state.teams = [];
  state.events = [];
  state.transcripts = {};
  setIdCounter(0);
});

afterEach(async () => {
  // Let the debounced state persist flush so the timer sanitizer passes.
  await new Promise((r) => setTimeout(r, 500));
});

describe("translateAdkEvent", () => {
  it("model text parts become transcript text and feed the turn summary", () => {
    const tracker = { cost: 0 };
    translateAdkEvent("s-1", {
      content: { role: "model", parts: [{ text: "Working on it." }] },
    }, "gemini-flash", tracker);

    assert(state.transcripts["s-1"]?.some((m) => m.k === "text" && m.text === "Working on it."));

    flushTurnSummary("s-1");
    assert(state.transcripts["s-1"]?.some((m) => m.k === "summary"));
    assert(state.events.some((e) => e.kind === "message" && e.body === "Working on it."));
  });

  it("partial streaming frames never reach the transcript", () => {
    const tracker = { cost: 0 };
    translateAdkEvent("s-1", {
      content: { role: "model", parts: [{ text: "Work" }] },
      partial: true,
    }, "gemini-flash", tracker);

    assertEquals(state.transcripts["s-1"] ?? [], []);
  });

  it("function calls and responses become tool transcript lines", () => {
    const tracker = { cost: 0 };
    translateAdkEvent("s-1", {
      content: { role: "model", parts: [{ functionCall: { name: "read_file", args: { path: "a.ts" } } }] },
    }, "gemini-flash", tracker);
    translateAdkEvent("s-1", {
      content: { role: "user", parts: [{ functionResponse: { name: "read_file", response: { content: "x".repeat(2000) } } }] },
    }, "gemini-flash", tracker);

    const tools = (state.transcripts["s-1"] ?? []).filter((m) => m.k === "tool");
    assertEquals(tools.length, 2);
    assert(tools[0].text!.includes("▸ read_file"));
    assert(tools[0].text!.includes("a.ts"));
    assert(tools[1].text!.length <= 800, "responses are sliced");
  });

  it("usage metadata updates ctx against the 1M window and accumulates cost", () => {
    const tracker = { cost: 0 };
    translateAdkEvent("s-1", {
      usageMetadata: { promptTokenCount: 100_000, candidatesTokenCount: 1_000 },
    }, "gemini-flash", tracker);

    assertEquals(state.sessions[0].ctx, 10);
    assert(tracker.cost > 0);
  });

  it("a user-role text event is not treated as an assistant message", () => {
    const tracker = { cost: 0 };
    translateAdkEvent("s-1", {
      content: { role: "user", parts: [{ text: "echoed user content" }] },
    }, "gemini-flash", tracker);

    assert(!(state.transcripts["s-1"] ?? []).some((m) => m.k === "text"));
  });
});

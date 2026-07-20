import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import type { SDKMessage } from "npm:@anthropic-ai/claude-agent-sdk@^0.3.204";
import type { Session, Team } from "../../src/kraken/types.ts";

// agent-sessions transitively imports state-store (file paths bind at
// import time) — isolate before loading.
Deno.env.set("KRAKEN_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-agent-msg-test-" }));
const { handleMessage } = await import("./agent-sessions.ts");
const { state, setIdCounter } = await import("./state.ts");

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "tm-1",
    name: "Team",
    goal: "",
    dir: "/repo",
    baseRef: "HEAD",
    startedAt: 0,
    mcpConfigIds: [],
    coordination: "sequenced",
    workersStarted: false,
    useWorktree: true,
    boardSlug: null,
    ...overrides,
  };
}

function makeSession(id: string, status: Session["status"]): Session {
  return {
    id,
    name: id,
    short: id,
    baseName: id,
    teamId: null,
    lead: false,
    status,
    statusLine: "",
    phase: "executing",
    msDone: 0,
    msTotal: 4,
    startedAt: 0,
    cost: 0,
    model: "sonnet",
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

function msg(fields: Record<string, unknown>): SDKMessage {
  return fields as unknown as SDKMessage;
}

beforeEach(() => {
  state.sessions = [];
  state.teams = [];
  state.events = [];
  state.transcripts = {};
  setIdCounter(0);
});

afterEach(async () => {
  // Let the debounced state persist flush so the timer sanitizer passes.
  await new Promise((r) => setTimeout(r, 500));
});

describe("handleMessage status mapping", () => {
  // The regression that motivated this file: session_state_changed idle
  // never fires for plain streaming-input queries, so "result" is the
  // turn-over signal — a session must land on idle, not stay running.
  it("a successful result flips a running session to idle", () => {
    state.sessions = [makeSession("s-1", "running")];
    handleMessage("s-1", msg({ type: "result", subtype: "success", total_cost_usd: 0.5 }));

    const session = state.sessions[0];
    assertEquals(session.status, "idle");
    assert(session.statusLine.startsWith("Idle — ready"));
    assertEquals(session.cost, 0.5);
  });

  it("an errored result also lands on idle, labeled honestly", () => {
    state.sessions = [makeSession("s-1", "running")];
    handleMessage("s-1", msg({ type: "result", subtype: "error_during_execution", errors: ["boom"] }));

    assertEquals(state.sessions[0].status, "idle");
    assert(state.sessions[0].statusLine.includes("error"));
    assert(state.events.some((e) => e.kind === "error" && e.verb === "boom"));
  });

  it("a result never clobbers paused, waiting, or stopped", () => {
    for (const status of ["paused", "waiting", "stopped"] as const) {
      state.sessions = [makeSession("s-1", status)];
      handleMessage("s-1", msg({ type: "result", subtype: "success" }));
      assertEquals(state.sessions[0].status, status, `status ${status} must survive a result`);
    }
  });

  it("system init marks the session running", () => {
    state.sessions = [makeSession("s-1", "idle")];
    handleMessage("s-1", msg({ type: "system", subtype: "init" }));
    assertEquals(state.sessions[0].status, "running");
  });

  it("result usage updates the context gauge against the model's real window", () => {
    state.sessions = [makeSession("s-1", "running")];
    handleMessage(
      "s-1",
      msg({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 20_000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 0 },
        modelUsage: { "claude-sonnet-5": { contextWindow: 100_000 } },
      }),
    );
    assertEquals(state.sessions[0].ctx, 50);
  });
});

describe("handleMessage plan capture", () => {
  it("ExitPlanMode turns the preceding assistant text into a plan card + artifact, not a generic tool log", () => {
    state.sessions = [makeSession("s-1", "running")];
    handleMessage(
      "s-1",
      msg({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "## Plan\nStep one.\nStep two." },
            { type: "tool_use", name: "ExitPlanMode", input: {} },
          ],
        },
      }),
    );

    const planMessage = state.transcripts["s-1"]?.find((m) => m.k === "plan");
    assert(planMessage, "expected a plan transcript message");
    assert(planMessage!.text!.includes("Step one."));
    assert(!state.transcripts["s-1"]?.some((m) => m.k === "tool" && m.text?.includes("ExitPlanMode")));

    const planEvent = state.events.find((e) => e.kind === "artifact" && e.artName === "Plan");
    assert(planEvent, "expected a plan artifact event");
    assertEquals(planEvent!.sid, "s-1");
    assert(planEvent!.artPreview!.length > 0);
  });

  it("a non-plan tool_use is untouched — no plan card, still logged generically", () => {
    state.sessions = [makeSession("s-1", "running")];
    handleMessage(
      "s-1",
      msg({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
      }),
    );

    assert(!state.transcripts["s-1"]?.some((m) => m.k === "plan"));
    assert(!state.events.some((e) => e.kind === "artifact"));
    assert(state.transcripts["s-1"]?.some((m) => m.k === "tool" && m.text?.includes("Bash")));
  });

  it("a sequenced-team lead's KRAKEN_TASKS.md becomes a plan after a successful turn", async () => {
    const worktreePath = await Deno.makeTempDir({ prefix: "sb-plan-spec-test-" });
    await Deno.writeTextFile(
      join(worktreePath, "KRAKEN_TASKS.md"),
      "## Backend\nBuild the API.\n\n## Frontend\nBuild the UI.\n",
    );
    state.sessions = [{ ...makeSession("s-1", "running"), lead: true, teamId: "tm-1", worktreePath }];
    state.teams = [makeTeam()];

    handleMessage("s-1", msg({ type: "result", subtype: "success" }));
    // checkForSpecPlan is fire-and-forget (reads the file async) — give its
    // promise chain a tick to settle before asserting.
    await new Promise((r) => setTimeout(r, 100));

    const planEvent = state.events.find((e) => e.kind === "artifact" && e.artName === "Plan");
    assert(planEvent, "expected a plan artifact event from the spec file");
    assert(planEvent!.body!.includes("Backend"));
    assert(planEvent!.body!.includes("Frontend"));
  });

  it("a classic (non-sequenced) team's lead never gets a spec-file plan", async () => {
    const worktreePath = await Deno.makeTempDir({ prefix: "sb-plan-spec-test-" });
    await Deno.writeTextFile(join(worktreePath, "KRAKEN_TASKS.md"), "## Task\nDo it.\n");
    state.sessions = [{ ...makeSession("s-1", "running"), lead: true, teamId: "tm-1", worktreePath }];
    state.teams = [makeTeam({ coordination: "classic" })];

    handleMessage("s-1", msg({ type: "result", subtype: "success" }));
    await new Promise((r) => setTimeout(r, 100));

    assert(!state.events.some((e) => e.kind === "artifact" && e.artName === "Plan"));
  });
});

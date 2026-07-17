import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import type { Session } from "../../src/switchboard/types.ts";

// Isolate state-store file paths before the module graph loads.
Deno.env.set("SWITCHBOARD_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-adk-tools-test-" }));
const { beginPlanning, buildCodingTools, clearPlanPhase, gateToolCall, settlePendingGates } = await import("./adk-tools.ts");
const { registerAgentSession, unregisterAgentSession, resolvePendingApproval } = await import("./agent-registry.ts");
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

function registerHandle(sid: string, sessionAllowAll: boolean): void {
  registerAgentSession(sid, {
    interrupt: () => Promise.resolve(),
    close: () => {},
    setModel: () => Promise.resolve(),
    pushMessage: () => {},
    dir: "/repo",
    worktreePath: "/repo",
    branch: null,
    sessionAllowAll,
  });
}

// FunctionTool.runAsync validates args against the zod schema, then calls
// our execute — toolContext is unused by every tool here.
// deno-lint-ignore no-explicit-any
const noContext = undefined as any;

let worktree: string;

beforeEach(async () => {
  state.sessions = [makeSession("s-1")];
  state.events = [];
  state.transcripts = {};
  setIdCounter(0);
  worktree = await Deno.makeTempDir({ prefix: "sb-adk-worktree-" });
});

afterEach(async () => {
  unregisterAgentSession("s-1");
  await new Promise((r) => setTimeout(r, 500));
});

function tools(sessionAllowAll = false, planFirst = false) {
  registerHandle("s-1", sessionAllowAll);
  const list = buildCodingTools({ sid: "s-1", worktreePath: worktree, currentSignal: () => undefined, planFirst });
  return Object.fromEntries(list.map((t) => [t.name, t]));
}

describe("adk-tools path jail", () => {
  it("reads a file inside the worktree", async () => {
    await Deno.writeTextFile(join(worktree, "a.txt"), "hello");
    const result = await tools().read_file.runAsync({ args: { path: "a.txt" }, toolContext: noContext }) as { content?: string };
    assertEquals(result.content, "hello");
  });

  it("rejects ../ escapes and absolute paths outside the worktree", async () => {
    const t = tools();
    const up = await t.read_file.runAsync({ args: { path: "../outside.txt" }, toolContext: noContext }) as { error?: string };
    assert(up.error?.includes("escapes"));
    const abs = await t.read_file.runAsync({ args: { path: "/etc/hosts" }, toolContext: noContext }) as { error?: string };
    assert(abs.error?.includes("escapes"));
  });

  it("list_dir and grep stay inside the jail too", async () => {
    await Deno.writeTextFile(join(worktree, "b.ts"), "const kraken = 1;\n");
    const t = tools(true);
    const listing = await t.list_dir.runAsync({ args: {}, toolContext: noContext }) as { entries?: string[] };
    assert(listing.entries?.includes("b.ts"));
    const found = await t.grep.runAsync({ args: { pattern: "kraken" }, toolContext: noContext }) as { matches?: string[] };
    assertEquals(found.matches?.length, 1);
    const escaped = await t.grep.runAsync({ args: { pattern: "x", path: "../../" }, toolContext: noContext }) as { error?: string };
    assert(escaped.error?.includes("escapes"));
  });
});

describe("adk-tools approval gating", () => {
  it("sessionAllowAll bypasses the gate with no approval event", async () => {
    registerHandle("s-1", true);
    const decision = await gateToolCall("s-1", "bash", "ls", "test");
    assertEquals(decision, { allow: true });
    assertEquals(state.events.length, 0);
  });

  it("a gated call posts an approval event, flips to waiting, and resolves on approve", async () => {
    registerHandle("s-1", false);
    const pending = gateToolCall("s-1", "bash", "rm -rf scratch", "test");

    const event = state.events.find((e) => e.kind === "approval");
    assert(event, "approval event posted");
    assertEquals(event!.command, "rm -rf scratch");
    assertEquals(state.sessions[0].status, "waiting");
    assert(state.transcripts["s-1"]?.some((m) => m.k === "perm" && m.eventId === event!.id));

    assert(resolvePendingApproval(event!.id, { allow: true }));
    assertEquals(await pending, { allow: true });
  });

  it("a denied gate makes the tool return the denial as an error result", async () => {
    registerHandle("s-1", false);
    const t = tools();
    const resultPromise = t.write_file.runAsync({ args: { path: "c.txt", content: "nope" }, toolContext: noContext });

    // Let the gate register its approval event.
    await new Promise((r) => setTimeout(r, 10));
    const event = state.events.find((e) => e.kind === "approval")!;
    resolvePendingApproval(event.id, { allow: false, message: "Denied by the user." });

    const result = await resultPromise as { error?: string };
    assertEquals(result.error, "Denied by the user.");
    await Deno.stat(join(worktree, "c.txt")).then(
      () => assert(false, "file must not exist after a denial"),
      () => {},
    );
  });

  it("settlePendingGates denies every outstanding gate — a stop can't leave a tool hanging", async () => {
    registerHandle("s-1", false);
    const first = gateToolCall("s-1", "bash", "sleep 100", "test");
    const second = gateToolCall("s-1", "edit_file", "edit x.ts", "test");

    settlePendingGates("s-1", "Session ended.");

    assertEquals(await first, { allow: false, message: "Session ended." });
    assertEquals(await second, { allow: false, message: "Session ended." });
  });

  it("an approved write_file actually writes", async () => {
    registerHandle("s-1", false);
    const t = tools();
    const resultPromise = t.write_file.runAsync({ args: { path: "d.txt", content: "yes" }, toolContext: noContext });
    await new Promise((r) => setTimeout(r, 10));
    const event = state.events.find((e) => e.kind === "approval")!;
    resolvePendingApproval(event.id, { allow: true });

    const result = await resultPromise as { ok?: boolean };
    assertEquals(result.ok, true);
    assertEquals(await Deno.readTextFile(join(worktree, "d.txt")), "yes");
  });
});

describe("adk-tools plan mode", () => {
  it("exposes submit_plan only when planFirst is set", () => {
    assert(!("submit_plan" in tools(false, false)), "no submit_plan without planFirst");
    assert("submit_plan" in tools(false, true), "submit_plan present with planFirst");
  });

  it("blocks mutating tools while planning, without posting an approval event", async () => {
    const t = tools(false, true);
    beginPlanning("s-1");
    const w = await t.write_file.runAsync({ args: { path: "x.txt", content: "no" }, toolContext: noContext }) as { error?: string };
    assert(w.error?.includes("plan mode"));
    const b = await t.bash.runAsync({ args: { command: "ls" }, toolContext: noContext }) as { error?: string };
    assert(b.error?.includes("plan mode"));
    assertEquals(state.events.filter((e) => e.kind === "approval").length, 0, "no gate while planning");
    await Deno.stat(join(worktree, "x.txt")).then(() => assert(false, "must not write while planning"), () => {});
    clearPlanPhase("s-1");
  });

  it("submit_plan posts a plan artifact + approval; approving unlocks mutating tools in the same session", async () => {
    const t = tools(false, true);
    beginPlanning("s-1");

    const submitPromise = t.submit_plan.runAsync({ args: { plan: "Step one.\nStep two." }, toolContext: noContext });
    await new Promise((r) => setTimeout(r, 10));
    assert(state.events.some((e) => e.kind === "artifact" && e.artName === "Plan"), "plan artifact posted");
    assert(state.transcripts["s-1"]?.some((m) => m.k === "plan"), "plan transcript card");
    const gate = state.events.find((e) => e.kind === "approval")!;
    resolvePendingApproval(gate.id, { allow: true });
    const submit = await submitPromise as { ok?: boolean };
    assertEquals(submit.ok, true);

    // Now a mutating tool proceeds (gates normally instead of being blocked).
    const wPromise = t.write_file.runAsync({ args: { path: "y.txt", content: "yes" }, toolContext: noContext });
    await new Promise((r) => setTimeout(r, 10));
    const wGate = state.events.find((e) => e.kind === "approval" && e.command?.includes("write y.txt"))!;
    assert(wGate, "write_file now gates instead of refusing");
    resolvePendingApproval(wGate.id, { allow: true });
    assertEquals((await wPromise as { ok?: boolean }).ok, true);
    clearPlanPhase("s-1");
  });

  it("a denied plan keeps mutating tools blocked and tells the model to revise", async () => {
    const t = tools(false, true);
    beginPlanning("s-1");

    const submitPromise = t.submit_plan.runAsync({ args: { plan: "bad plan" }, toolContext: noContext });
    await new Promise((r) => setTimeout(r, 10));
    const gate = state.events.find((e) => e.kind === "approval")!;
    resolvePendingApproval(gate.id, { allow: false, message: "Denied by the user." });
    const submit = await submitPromise as { error?: string };
    assert(submit.error?.includes("Revise"));

    const w = await t.write_file.runAsync({ args: { path: "z.txt", content: "no" }, toolContext: noContext }) as { error?: string };
    assert(w.error?.includes("plan mode"), "still blocked after a denied plan");
    clearPlanPhase("s-1");
  });
});

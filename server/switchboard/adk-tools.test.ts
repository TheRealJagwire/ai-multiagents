import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import type { Session } from "../../src/switchboard/types.ts";

// Isolate state-store file paths before the module graph loads.
Deno.env.set("SWITCHBOARD_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-adk-tools-test-" }));
const { buildCodingTools, gateToolCall, settlePendingGates } = await import("./adk-tools.ts");
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

function tools(sessionAllowAll = false) {
  registerHandle("s-1", sessionAllowAll);
  const list = buildCodingTools({ sid: "s-1", worktreePath: worktree, currentSignal: () => undefined });
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

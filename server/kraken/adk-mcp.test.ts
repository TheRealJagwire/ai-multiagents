import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import type { McpConfig, Session } from "../../src/kraken/types.ts";

Deno.env.set("KRAKEN_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-adk-mcp-test-" }));
const { buildMcpToolsets, mcpConfigToConnectionParams } = await import("./adk-mcp.ts");
const { registerAgentSession, unregisterAgentSession, resolvePendingApproval } = await import("./agent-registry.ts");
const { state, setIdCounter } = await import("./state.ts");

function cfg(overrides: Partial<McpConfig>): McpConfig {
  return { id: "m1", name: "Srv", transport: "stdio", command: "", args: [], env: {}, url: "", headers: {}, ...overrides };
}

function makeSession(id: string): Session {
  return {
    id, name: id, short: id, baseName: id, teamId: null, lead: false, status: "running", statusLine: "",
    phase: "executing", msDone: 0, msTotal: 4, startedAt: 0, cost: 0, model: "gemini-flash", effort: "medium",
    ctx: 1, dep: "", pendingModel: null, pendingEffort: null, pendingMove: null, dir: "/repo",
    worktreePath: null, branch: null, useWorktree: true, mcpConfigIds: [],
  };
}

describe("mcpConfigToConnectionParams", () => {
  it("maps a stdio config to StdioConnectionParams", () => {
    const params = mcpConfigToConnectionParams(cfg({ transport: "stdio", command: "deno", args: ["run"], env: { X: "1" } }));
    assertEquals(params, { type: "StdioConnectionParams", serverParams: { command: "deno", args: ["run"], env: { X: "1" } } });
  });

  it("omits empty args/env", () => {
    const params = mcpConfigToConnectionParams(cfg({ transport: "stdio", command: "srv" }));
    assertEquals(params, { type: "StdioConnectionParams", serverParams: { command: "srv" } });
  });

  it("maps http/sse to StreamableHTTPConnectionParams with headers under transportOptions", () => {
    const http = mcpConfigToConnectionParams(cfg({ transport: "http", url: "http://x/mcp", headers: { A: "b" } }));
    assertEquals(http, { type: "StreamableHTTPConnectionParams", url: "http://x/mcp", transportOptions: { requestInit: { headers: { A: "b" } } } });
    const sse = mcpConfigToConnectionParams(cfg({ transport: "sse", url: "http://y/mcp" }));
    assertEquals(sse, { type: "StreamableHTTPConnectionParams", url: "http://y/mcp" });
  });
});

describe("buildMcpToolsets", () => {
  beforeEach(() => {
    state.sessions = [makeSession("s-1")];
    state.events = [];
    state.transcripts = {};
    state.mcpConfigs = [];
    setIdCounter(0);
    registerAgentSession("s-1", {
      interrupt: () => Promise.resolve(),
      close: () => {},
      setModel: () => Promise.resolve(),
      pushMessage: () => {},
      dir: "/repo",
      worktreePath: "/repo",
      branch: null,
      sessionAllowAll: false,
    });
  });

  afterEach(async () => {
    unregisterAgentSession("s-1");
    await new Promise((r) => setTimeout(r, 300));
  });

  it("a missing config id is silently skipped", async () => {
    const bundle = await buildMcpToolsets("s-1", ["nope"]);
    assertEquals(bundle.tools.length, 0);
    assertEquals(bundle.toolsets.length, 0);
  });

  it("an unreachable server warns via a feed event and does not throw", async () => {
    state.mcpConfigs = [cfg({ id: "bad", name: "Bad", transport: "stdio", command: "definitely-not-a-real-binary-xyz" })];
    const bundle = await buildMcpToolsets("s-1", ["bad"]);
    assertEquals(bundle.tools.length, 0);
    assert(state.events.some((e) => e.kind === "error" && e.verb.includes("Bad")));
  });

  it("discovers a stdio server's tools, prefixes them, and gates each call", async () => {
    const serverPath = fromFileUrl(new URL("../../tools/adk-spike-mcp-server.ts", import.meta.url));
    state.mcpConfigs = [cfg({ id: "spike", name: "Spike", transport: "stdio", command: "deno", args: ["run", "-A", serverPath] })];

    const bundle = await buildMcpToolsets("s-1", ["spike"]);
    try {
      const ping = bundle.tools.find((t) => t.name.endsWith("ping"));
      assert(ping, `expected a ping tool, got: ${bundle.tools.map((t) => t.name).join(", ")}`);
      assert(ping!.name.startsWith("spike"), "tool name is prefixed by the server slug");

      // Calling it gates first, then delegates to the server on approval.
      // The inner MCPTool reads toolContext.abortSignal — ADK's Runner always
      // supplies a real Context; here we hand it a minimal stand-in.
      const runPromise = ping!.runAsync({ args: { note: "hi" }, toolContext: { abortSignal: new AbortController().signal } } as never);
      await new Promise((r) => setTimeout(r, 20));
      const gate = state.events.find((e) => e.kind === "approval");
      assert(gate, "MCP call posted an approval event");
      resolvePendingApproval(gate!.id, { allow: true });
      const result = await runPromise;
      assert(JSON.stringify(result).includes("pong: hi"), `expected pong from the server, got ${JSON.stringify(result)}`);
    } finally {
      await Promise.all(bundle.toolsets.map((t) => t.close().catch(() => {})));
    }
  });
});

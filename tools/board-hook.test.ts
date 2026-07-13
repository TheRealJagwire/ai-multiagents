import { afterAll, beforeAll, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import type { HookConfig } from "./board-hook.ts";

// Integration setup: the hooks talk real HTTP, so host the orchestration
// app on an ephemeral port. Storage isolated to a temp dir (must be set
// before routes.ts imports and opens KV).
Deno.env.set("SWITCHBOARD_DATA_DIR", await Deno.makeTempDir({ prefix: "board-hook-test-" }));
const { runHook } = await import("./board-hook.ts");
const { orchestrationApp } = await import("../server/orchestration/routes.ts");
const { stopReaper } = await import("../server/orchestration/service.ts");

let server: Deno.HttpServer;
let cfg: HookConfig;

beforeAll(async () => {
  server = Deno.serve({ port: 0, onListen: () => {} }, orchestrationApp.fetch);
  const { port } = server.addr as Deno.NetAddr;
  const base = `http://127.0.0.1:${port}`;
  cfg = {
    board: "hook-board",
    base,
    stateDir: await Deno.makeTempDir({ prefix: "board-hook-state-" }),
    agentName: "hook-worker",
    agentRole: "tester",
  };
  const created = await fetch(`${base}/boards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "hook-board", title: "hook board" }),
  });
  assertEquals(created.status, 201);
  await created.body?.cancel();
});

afterAll(async () => {
  stopReaper();
  await server.shutdown();
});

async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return await res.json() as T;
}

function parseContext(output: string | null): string {
  assert(output !== null, "expected hook output");
  return JSON.parse(output).hookSpecificOutput.additionalContext as string;
}

describe("board-hook", () => {
  const SID = "hooksess01";
  let agentId: string;

  it("session-start registers the agent and injects identity + team status", async () => {
    const context = parseContext(await runHook("session-start", { session_id: SID }, cfg));
    assert(context.includes("registered on board 'hook-board' as hook-worker"));
    const match = context.match(/agent_id: (\S+)\)/);
    assert(match, `no agent_id in: ${context}`);
    agentId = match[1];

    const agents = await rest<Array<{ id: string; name: string }>>("GET", "/boards/hook-board/agents");
    assertEquals(agents.length, 1);
    assertEquals(agents[0].id, agentId);
  });

  it("session-start against a dead daemon degrades to an inactive-protocol notice", async () => {
    const deadCfg: HookConfig = { ...cfg, base: "http://127.0.0.1:1", timeoutMs: 300 };
    const context = parseContext(await runHook("session-start", { session_id: "deadsess" }, deadCfg));
    assert(context.includes("unreachable"));
  });

  it("prompt-submit stays silent with nothing unread, nudges once messages arrive", async () => {
    // The registration cursor init (M6) means a fresh agent starts clean.
    assertEquals(await runHook("prompt-submit", { session_id: SID }, cfg), null);

    // A broadcast from another agent is news.
    const other = await rest<{ id: string }>("POST", "/boards/hook-board/agents", { name: "chatty", role: "t" });
    await rest("POST", "/boards/hook-board/messages", { from: other.id, to: agentId, body: "heads up" });
    const context = parseContext(await runHook("prompt-submit", { session_id: SID }, cfg));
    assert(context.includes("1 unread message(s)"));
  });

  it("post-tool-use warns on an out-of-scope edit and stays silent in scope", async () => {
    const card = await rest<{ id: string }>("POST", "/boards/hook-board/cards", {
      title: "scoped work",
      description: "x",
      fileScope: ["server/orchestration/**"],
    });
    const claimed = await rest<{ id: string }>("POST", `/boards/hook-board/cards/${card.id}/claim`, { agentId });
    assertEquals(claimed.id, card.id);

    const inScope = await runHook("post-tool-use", {
      session_id: SID,
      cwd: "/repo",
      tool_name: "Edit",
      tool_input: { file_path: "/repo/server/orchestration/service.ts" },
    }, cfg);
    assertEquals(inScope, null);

    const outOfScope = parseContext(await runHook("post-tool-use", {
      session_id: SID,
      cwd: "/repo",
      tool_name: "Edit",
      tool_input: { file_path: "/repo/src/App.tsx" },
    }, cfg));
    assert(outOfScope.includes("outside your card's fileScope"));
  });

  it("session-end releases the held card, then marks the agent offline", async () => {
    assertEquals(await runHook("session-end", { session_id: SID }, cfg), null);

    const agents = await rest<Array<{ id: string; status: string; currentCardId?: string }>>("GET", "/boards/hook-board/agents");
    const me = agents.find((a) => a.id === agentId)!;
    assertEquals(me.status, "offline");
    assertEquals(me.currentCardId, undefined);

    const events = await rest<Array<{ type: string; detail?: string }>>("GET", "/boards/hook-board/events");
    assert(events.some((e) => e.type === "card.released" && e.detail === "session ended"));

    // Identity file consumed — a follow-up hook run is a clean no-op.
    assertEquals(await runHook("prompt-submit", { session_id: SID }, cfg), null);
  });
});

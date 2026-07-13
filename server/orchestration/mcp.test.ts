import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";

Deno.env.set("SWITCHBOARD_DATA_DIR", await Deno.makeTempDir({ prefix: "orch-mcp-test-" }));
const { mcpFetch } = await import("./mcp.ts");

// Drives the real Streamable HTTP surface the way a client would: one
// JSON-RPC tools/call per request (the transport is stateless per request,
// so no initialize handshake is needed). Responses come back as SSE frames;
// unwrap the single data: line.
let rpcId = 0;

async function callTool(
  name: string,
  args: Record<string, unknown>,
  queryBoard?: string,
): Promise<{ isError: boolean; data: unknown; raw: string }> {
  const request = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const response = await mcpFetch(request, queryBoard);
  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  assert(dataLine, `no SSE data frame in response: ${text}`);
  const rpc = JSON.parse(dataLine.slice(5));
  const content = rpc.result.content[0].text as string;
  return { isError: rpc.result.isError === true, data: JSON.parse(content), raw: content };
}

describe("orchestration MCP", () => {
  it("register_agent returns agent_id, the protocol, and a slim team view", async () => {
    await callTool("create_board", { slug: "mcp-reg", title: "t" });
    const { data, isError } = await callTool("register_agent", { name: "mcp-worker", role: "tester" }, "mcp-reg");
    assert(!isError);
    const result = data as { agent_id: string; board: string; protocol: string; team: Array<Record<string, unknown>> };
    assert(result.agent_id.length > 0);
    assertEquals(result.board, "mcp-reg");
    assert(result.protocol.includes("Worker protocol"));
    // Slim team view: exactly the five display fields, nothing else.
    const keys = Object.keys(result.team[0]).sort();
    assertEquals(keys, ["id", "lastHeartbeatAt", "name", "role", "status"]);
  });

  it("board resolution precedence: explicit arg beats the connection's ?board=", async () => {
    await callTool("create_board", { slug: "mcp-query-board", title: "q" });
    await callTool("create_board", { slug: "mcp-explicit-board", title: "e" });

    const { data } = await callTool("get_board_status", { board: "mcp-explicit-board" }, "mcp-query-board");
    const status = data as { board: { slug: string } };
    assertEquals(status.board.slug, "mcp-explicit-board");
  });

  it("board resolution falls back to the calling agent's board when no board is passed", async () => {
    await callTool("create_board", { slug: "mcp-agent-board", title: "a" });
    const reg = await callTool("register_agent", { name: "bound-worker", role: "t" }, "mcp-agent-board");
    const agentId = (reg.data as { agent_id: string }).agent_id;

    // Connection pinned to a DIFFERENT board; only agent_id identifies the
    // real one. Resolution order: explicit > agent binding > query param.
    await callTool("create_board", { slug: "mcp-other-board", title: "o" });
    const hb = await callTool("heartbeat", { agent_id: agentId }, "mcp-other-board");
    assert(!hb.isError);
    assertEquals((hb.data as { agent: { id: string } }).agent.id, agentId);
  });

  it("no board resolvable at all is a tool error, not a crash", async () => {
    const { isError, data } = await callTool("get_board_status", {});
    assert(isError);
    assert((data as { error: string }).error.includes("no board resolved"));
  });

  it("tool outputs never leak boardId (M6 token audit)", async () => {
    await callTool("create_board", { slug: "mcp-slim", title: "t" });
    const reg = await callTool("register_agent", { name: "slim-worker", role: "t" }, "mcp-slim");
    const agentId = (reg.data as { agent_id: string }).agent_id;
    await callTool("create_card", { title: "task", description: "x" }, "mcp-slim");

    const claimed = await callTool("claim_next_card", { agent_id: agentId }, "mcp-slim");
    assert(!claimed.isError);
    assert(!claimed.raw.includes("boardId"), "claim output must not carry boardId");

    const card = claimed.data as { id: string };
    const detail = await callTool("get_card", { card_id: card.id }, "mcp-slim");
    assert(!detail.raw.includes("boardId"), "get_card output must not carry boardId");

    const team = await callTool("get_team_status", {}, "mcp-slim");
    assert(!team.raw.includes("boardId") && !team.raw.includes("registeredAt"));
  });

  it("unknown card is an isError result with the message", async () => {
    await callTool("create_board", { slug: "mcp-unknown", title: "t" });
    const { isError, data } = await callTool("get_card", { card_id: "01NOTREAL00000000000000000" }, "mcp-unknown");
    assert(isError);
    assert((data as { error: string }).error.includes("unknown card"));
  });

  it("full lifecycle over MCP: claim, progress, complete unblocks a dependent", async () => {
    await callTool("create_board", { slug: "mcp-flow", title: "t" });
    const reg = await callTool("register_agent", { name: "flow-worker", role: "t" }, "mcp-flow");
    const agentId = (reg.data as { agent_id: string }).agent_id;

    const up = await callTool("create_card", { title: "upstream", description: "x" }, "mcp-flow");
    const upId = (up.data as { id: string }).id;
    const down = await callTool("create_card", { title: "downstream", description: "x", dependsOn: [upId] }, "mcp-flow");
    assertEquals((down.data as { status: string }).status, "backlog");

    const claimed = await callTool("claim_next_card", { agent_id: agentId }, "mcp-flow");
    assertEquals((claimed.data as { id: string }).id, upId);

    await callTool("update_card_progress", { agent_id: agentId, card_id: upId, note: "going" }, "mcp-flow");
    const done = await callTool("complete_card", { agent_id: agentId, card_id: upId, result: "done", branch: "card/up" }, "mcp-flow");
    assertEquals((done.data as { status: string }).status, "done");

    const downAfter = await callTool("get_card", { card_id: (down.data as { id: string }).id }, "mcp-flow");
    assertEquals((downAfter.data as { status: string }).status, "ready", "dependent unblocked by completion");
  });
});

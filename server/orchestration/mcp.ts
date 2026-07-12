// MCP Streamable HTTP surface — the primary way Claude Code sessions talk
// to a board (plan section 5). Mounted at /api/orchestration/mcp (see
// routes.ts), read `?board=<slug>` from a repo's .mcp.json.
//
// Every tool is a thin wrapper over service.ts — no coordination logic
// lives here, only request parsing/board-resolution/response-shaping, so
// REST and MCP can never drift apart on what a "claim" or "complete" means.
//
// Stateless per the SDK's own recommended Hono pattern: a fresh McpServer +
// WebStandardStreamableHTTPServerTransport is created for every HTTP
// request (see mcpFetch below). That's more setup work per call than a
// persistent session, but it sidesteps session-lifecycle complexity
// entirely, and at this scale (a local, single-machine daemon) the cost is
// negligible. It also makes "board resolution via the connection's ?board=
// query param" trivial: it's just c.req.query("board"), read fresh on
// every request, no session state to keep in sync.
//
// Scope note: full M3 + M4 tool surface, including send_message /
// check_messages / watch_events.

import { McpServer, ResourceTemplate } from "npm:@modelcontextprotocol/sdk@^1.29.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@^1.29.0/server/webStandardStreamableHttp.js";
import { z } from "npm:zod@^4.4.3";
import { getKv } from "./kv.ts";
import * as svc from "./service.ts";
import type { Agent, AgentStatus, Board, CardStatus } from "./types.ts";

const CARD_STATUSES = ["backlog", "ready", "in_progress", "review", "done", "blocked"] as const;
const AGENT_STATUSES = ["idle", "working", "blocked", "offline"] as const;

// Compact JSON-ish text per plan section 5's tool-layer design rules — no
// pretty-printing, token cost is a real constraint when several sessions poll.
//
// M6 token audit: every tool call is board-scoped by construction, so the
// boardId field repeated on each card/agent/event/message record is pure
// overhead for the calling session — strip it recursively at this single
// choke point. REST responses keep full fidelity; this is MCP-only.
function stripBoardId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripBoardId);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "boardId") continue;
      out[k] = stripBoardId(v);
    }
    return out;
  }
  return value;
}

function toolResult(data: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(stripBoardId(data)) }], isError };
}

// Team-status views drop meta/registeredAt — polling agents only need who's
// here, what they hold, and how fresh their heartbeat is (M6 token audit).
function slimAgent(a: Agent) {
  return { id: a.id, name: a.name, role: a.role, status: a.status, currentCardId: a.currentCardId, lastHeartbeatAt: a.lastHeartbeatAt };
}

function errorFrom(err: unknown): ReturnType<typeof toolResult> {
  return toolResult({ error: err instanceof Error ? err.message : String(err) }, true);
}

// Board resolution order (plan section 5): explicit `board` arg on the call
// -> the board bound to the calling agent_id -> the connection's ?board=
// query param. Throws (callers wrap in try/catch) rather than returning
// null, since every tool needs a board to do anything.
async function resolveBoardForCall(
  kv: Deno.Kv,
  queryBoard: string | undefined,
  explicitBoard: string | undefined,
  agentId: string | undefined,
): Promise<Board> {
  if (explicitBoard) {
    const board = await svc.resolveBoard(kv, explicitBoard);
    if (!board) throw new Error(`unknown board: ${explicitBoard}`);
    return board;
  }
  if (agentId) {
    const boardId = await svc.getAgentBoardId(kv, agentId);
    if (boardId) {
      const board = await svc.getBoardById(kv, boardId);
      if (board) return board;
    }
  }
  if (queryBoard) {
    const board = await svc.resolveBoard(kv, queryBoard);
    if (!board) throw new Error(`unknown board: ${queryBoard}`);
    return board;
  }
  throw new Error("no board resolved — pass `board`, or connect the MCP URL with ?board=<slug>");
}

// "Every mutating tool implicitly heartbeats its caller" (plan section 5) —
// several service functions (progress/move/complete/release) update the
// agent's currentCardId/status but don't touch lastHeartbeatAt themselves,
// so this is a uniform post-mutation step rather than relying on each
// service function to remember to do it. Best-effort: a heartbeat failure
// here should never mask the success of the mutation that already committed.
async function implicitHeartbeat(kv: Deno.Kv, boardId: string, agentId: string | undefined): Promise<void> {
  if (!agentId) return;
  await svc.heartbeat(kv, boardId, agentId).catch(() => {});
}

const PROTOCOL_REMINDER = [
  "Worker protocol:",
  "1. On start: register_agent with your role. Note your agent_id.",
  "2. Loop: claim_next_card. If nothing eligible, read the near-misses reason, then get_team_status; if truly idle, say so and stop.",
  "3. Work only within the card's fileScope, on its branch (card/<id-short> worktree).",
  "4. Call update_card_progress after each meaningful subtask, and heartbeat regularly.",
  "5. If another card's outcome affects you (interface change, shared contract), find its holder via get_team_status and send them a message before assuming anything.",
  "6. Finish with complete_card (result + branch). Then return to step 2.",
].join("\n");

// Builds a fresh, fully-configured McpServer for one request. `queryBoard`
// is closed over by every tool/resource/prompt handler below as the
// lowest-priority board-resolution tier.
function buildServer(queryBoard: string | undefined): McpServer {
  const server = new McpServer({ name: "orchestration", version: "0.1.0" });

  server.registerTool("list_boards", {
    description: "List every non-archived board with open-card and active-agent counts.",
    inputSchema: {},
  }, async () => {
    const kv = await getKv();
    return toolResult(await svc.listBoardSummaries(kv));
  });

  server.registerTool("create_board", {
    description: "Create a new board — an isolated namespace of cards/agents/events, typically one per repo or project.",
    inputSchema: { slug: z.string(), title: z.string(), description: z.string().optional() },
  }, async (args: { slug: string; title: string; description?: string }) => {
    const kv = await getKv();
    const result = await svc.createBoard(kv, args);
    return "error" in result ? toolResult(result, true) : toolResult(result);
  });

  server.registerTool("get_board_status", {
    description: "One board's summary: card counts per column, active/total agents, and queue depth (claimable cards right now).",
    inputSchema: { board: z.string().optional() },
  }, async ({ board }: { board?: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, undefined);
      return toolResult(await svc.getBoardStatus(kv, resolved.id));
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("register_agent", {
    description:
      "Register (idempotent upsert by name) as an agent on a board. Call this first. Returns your agent_id, the worker protocol, and current team status.",
    inputSchema: {
      board: z.string().optional(),
      name: z.string(),
      role: z.string(),
      meta: z.record(z.string(), z.string()).optional(),
    },
  }, async ({ board, name, role, meta }: { board?: string; name: string; role: string; meta?: Record<string, string> }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, undefined);
      const agent = await svc.registerAgent(kv, resolved.id, { name, role, meta });
      const team = await svc.listAgents(kv, resolved.id);
      return toolResult({ agent_id: agent.id, board: resolved.slug, protocol: PROTOCOL_REMINDER, team: team.map(slimAgent) });
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("heartbeat", {
    description:
      "Bump your liveness and renew the lease on your current card. Call periodically, and after any tool call that doesn't already do so. Returns unread-message and new-event counts — a cheap 'anything I should know?' ping.",
    inputSchema: { agent_id: z.string(), status: z.enum(AGENT_STATUSES).optional(), board: z.string().optional() },
  }, async ({ agent_id, status, board }: { agent_id: string; status?: AgentStatus; board?: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const hb = await svc.heartbeat(kv, resolved.id, agent_id, status);
      return toolResult({ agent: slimAgent(hb.agent), unreadMessages: hb.unreadMessages, newEvents: hb.newEvents });
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("get_team_status", {
    description: "Every agent on this board: status, current card, and when they were last seen. The awareness workhorse.",
    inputSchema: { board: z.string().optional() },
  }, async ({ board }: { board?: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, undefined);
      return toolResult((await svc.listAgents(kv, resolved.id)).map(slimAgent));
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("list_cards", {
    description: "Filtered card summaries (id, title, status, assignee, priority). Use get_card for full detail on one card.",
    inputSchema: { board: z.string().optional(), status: z.enum(CARD_STATUSES).optional(), assignee: z.string().optional() },
  }, async ({ board, status, assignee }: { board?: string; status?: CardStatus; assignee?: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, undefined);
      const cards = await svc.listCards(kv, resolved.id, { status, assignee });
      return toolResult(cards.map((c) => ({ id: c.id, title: c.title, status: c.status, assignee: c.assignee, priority: c.priority })));
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("get_card", {
    description: "Full card detail — description, acceptance criteria, fileScope, dependencies — plus its most recent related events.",
    inputSchema: { board: z.string().optional(), card_id: z.string() },
  }, async ({ board, card_id }: { board?: string; card_id: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, undefined);
      const card = await svc.getCard(kv, resolved.id, card_id);
      if (!card) return toolResult({ error: `unknown card: ${card_id}` }, true);
      const events = await svc.listEvents(kv, resolved.id);
      // Slimmed: id/cardId are redundant inside a single card's own view.
      const recentEvents = events.filter((e) => e.cardId === card_id).slice(-10)
        .map((e) => ({ type: e.type, actor: e.actor, detail: e.detail, createdAt: e.createdAt }));
      return toolResult({ ...card, recentEvents });
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("create_card", {
    description: "Create a card. Starts 'ready' if it has no dependencies, otherwise 'backlog' until they're all done. Any agent can create — leads decompose work with this.",
    inputSchema: {
      board: z.string().optional(),
      agent_id: z.string().optional(),
      title: z.string(),
      description: z.string(),
      priority: z.number().optional(),
      dependsOn: z.array(z.string()).optional(),
      fileScope: z.array(z.string()).optional(),
      acceptance: z.array(z.string()).optional(),
    },
  }, async (
    { board, agent_id, title, description, priority, dependsOn, fileScope, acceptance }: {
      board?: string;
      agent_id?: string;
      title: string;
      description: string;
      priority?: number;
      dependsOn?: string[];
      fileScope?: string[];
      acceptance?: string[];
    },
  ) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const card = await svc.createCard(kv, resolved.id, { title, description, priority, dependsOn, fileScope, acceptance });
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(card);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("claim_next_card", {
    description:
      "Atomically claim the best eligible ready card (priority order, respecting dependencies and fileScope). Returns the claimed card, or a structured explanation of why nothing was eligible.",
    inputSchema: { board: z.string().optional(), agent_id: z.string() },
  }, async ({ board, agent_id }: { board?: string; agent_id: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const result = await svc.claimNextCard(kv, resolved.id, agent_id);
      if (!result.ok) return toolResult({ error: result.message, nearMisses: result.nearMisses }, true);
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(result.card);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("claim_card", {
    description: "Claim a specific card by ID (same eligibility checks as claim_next_card).",
    inputSchema: { board: z.string().optional(), agent_id: z.string(), card_id: z.string() },
  }, async ({ board, agent_id, card_id }: { board?: string; agent_id: string; card_id: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const result = await svc.claimCard(kv, resolved.id, agent_id, card_id);
      if (!result.ok) return toolResult({ error: result.message, nearMisses: result.nearMisses }, true);
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(result.card);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("update_card_progress", {
    description: "Post a progress note on your claimed card and renew your lease. Cheap and encouraged — do this after each meaningful subtask.",
    inputSchema: { board: z.string().optional(), agent_id: z.string(), card_id: z.string(), note: z.string() },
  }, async ({ board, agent_id, card_id, note }: { board?: string; agent_id: string; card_id: string; note: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const card = await svc.updateCardProgress(kv, resolved.id, card_id, agent_id, note);
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(card);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("move_card", {
    description: "Move a card to a different status — e.g. 'blocked' if you can't proceed (keeps your claim, releases lease pressure), or 'review'.",
    inputSchema: {
      board: z.string().optional(),
      agent_id: z.string(),
      card_id: z.string(),
      status: z.enum(CARD_STATUSES),
      detail: z.string().optional(),
    },
  }, async (
    { board, agent_id, card_id, status, detail }: { board?: string; agent_id: string; card_id: string; status: CardStatus; detail?: string },
  ) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const card = await svc.moveCard(kv, resolved.id, card_id, agent_id, status, detail);
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(card);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("complete_card", {
    description: "Mark your claimed card done with a result summary. Releases you to idle and re-checks any cards waiting on this one's dependency.",
    inputSchema: {
      board: z.string().optional(),
      agent_id: z.string(),
      card_id: z.string(),
      result: z.string(),
      branch: z.string().optional(),
    },
  }, async (
    { board, agent_id, card_id, result, branch }: { board?: string; agent_id: string; card_id: string; result: string; branch?: string },
  ) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const card = await svc.completeCard(kv, resolved.id, card_id, agent_id, result, branch);
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(card);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("release_card", {
    description: "Voluntarily release your claimed card back to ready (e.g. you're stopping for now, or it turned out to be someone else's).",
    inputSchema: { board: z.string().optional(), agent_id: z.string(), card_id: z.string(), reason: z.string() },
  }, async ({ board, agent_id, card_id, reason }: { board?: string; agent_id: string; card_id: string; reason: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const card = await svc.releaseCard(kv, resolved.id, card_id, agent_id, reason);
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(card);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("send_message", {
    description:
      "Send a message to a specific agent (delivered to their inbox) or broadcast to the whole board (to: '*'). Use this before assuming anything about a card another agent holds — e.g. an interface change that affects them.",
    inputSchema: {
      board: z.string().optional(),
      from: z.string(),
      to: z.string(),
      body: z.string(),
      card_id: z.string().optional(),
    },
  }, async (
    { board, from, to, body, card_id }: { board?: string; from: string; to: string; body: string; card_id?: string },
  ) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, from);
      const message = await svc.sendMessage(kv, resolved.id, { from, to, body, cardId: card_id });
      await implicitHeartbeat(kv, resolved.id, from);
      return toolResult(message);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("check_messages", {
    description: "Drain your inbox and pull any new broadcasts since you last checked. Returns messages oldest-first. Call at natural checkpoints (after claiming, after progress updates).",
    inputSchema: { board: z.string().optional(), agent_id: z.string() },
  }, async ({ board, agent_id }: { board?: string; agent_id: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const messages = await svc.checkMessages(kv, resolved.id, agent_id);
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(messages);
    } catch (err) {
      return errorFrom(err);
    }
  });

  server.registerTool("watch_events", {
    description:
      "Events on this board since your last watch_events call (or an explicit `since` event ID). Advances your cursor. Use this for general awareness — what other agents are doing.",
    inputSchema: { board: z.string().optional(), agent_id: z.string(), since: z.string().optional() },
  }, async ({ board, agent_id, since }: { board?: string; agent_id: string; since?: string }) => {
    const kv = await getKv();
    try {
      const resolved = await resolveBoardForCall(kv, queryBoard, board, agent_id);
      const events = await svc.watchEvents(kv, resolved.id, agent_id, since);
      await implicitHeartbeat(kv, resolved.id, agent_id);
      return toolResult(events);
    } catch (err) {
      return errorFrom(err);
    }
  });

  // ---------- Resources: cheap read-only context injection ----------

  server.registerResource(
    "board-snapshot",
    new ResourceTemplate("board://{slug}/snapshot", { list: undefined }),
    { title: "Board snapshot", description: "Whole-board summary: status, columns, team." },
    async (uri: URL, { slug }: { slug: string | string[] }) => {
      const kv = await getKv();
      const board = await svc.resolveBoard(kv, String(slug));
      if (!board) return { contents: [{ uri: uri.toString(), text: JSON.stringify({ error: `unknown board: ${slug}` }) }] };
      const [status, team] = await Promise.all([svc.getBoardStatus(kv, board.id), svc.listAgents(kv, board.id)]);
      return { contents: [{ uri: uri.toString(), text: JSON.stringify({ ...status, team: team.map(slimAgent) }) }] };
    },
  );

  server.registerResource(
    "board-card",
    new ResourceTemplate("board://{slug}/card/{id}", { list: undefined }),
    { title: "Card detail", description: "Full detail for one card on one board." },
    async (uri: URL, { slug, id }: { slug: string | string[]; id: string | string[] }) => {
      const kv = await getKv();
      const board = await svc.resolveBoard(kv, String(slug));
      if (!board) return { contents: [{ uri: uri.toString(), text: JSON.stringify({ error: `unknown board: ${slug}` }) }] };
      const card = await svc.getCard(kv, board.id, String(id));
      if (!card) return { contents: [{ uri: uri.toString(), text: JSON.stringify({ error: `unknown card: ${id}` }) }] };
      return { contents: [{ uri: uri.toString(), text: JSON.stringify(card) }] };
    },
  );

  // ---------- Prompt: onboard a fresh session in one reference ----------

  server.registerPrompt(
    "worker-briefing",
    {
      title: "Worker briefing",
      description: "The worker protocol plus current board/team status — reference this to onboard a fresh session.",
      argsSchema: { board: z.string().optional() },
    },
    async ({ board }: { board?: string }) => {
      const kv = await getKv();
      const resolved = await resolveBoardForCall(kv, queryBoard, board, undefined).catch(() => null);
      const status = resolved ? await svc.getBoardStatus(kv, resolved.id) : null;
      const team = resolved ? await svc.listAgents(kv, resolved.id) : [];
      const lines = [
        PROTOCOL_REMINDER,
        "",
        resolved ? `Board: ${resolved.title} (${resolved.slug})` : "No board resolved — connect with ?board=<slug> or pass one explicitly.",
        status ? `Columns: ${JSON.stringify(status.columns)} — queue depth ${status.queueDepth}` : "",
        team.length > 0
          ? `Team: ${team.map((a) => `${a.name} (${a.role}, ${a.status})`).join(", ")}`
          : (resolved ? "No agents registered yet." : ""),
      ].filter((line) => line.length > 0);
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } }] };
    },
  );

  return server;
}

// Fresh McpServer + transport per request (the SDK's own recommended
// stateless Hono pattern) — see the module docstring for why.
export async function mcpFetch(request: Request, queryBoard: string | undefined): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = buildServer(queryBoard);
  await server.connect(transport);
  return await transport.handleRequest(request);
}

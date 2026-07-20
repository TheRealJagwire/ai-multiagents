// REST surface for the orchestration server. Mounted at /api/orchestration
// (see main.ts) — so e.g. board list is GET /api/orchestration/boards.
// Every handler is a thin wrapper over service.ts; there's no logic here
// beyond parsing/validating the request and shaping the response, so the
// MCP tool layer (M3) can call the exact same service functions later
// without duplicating any coordination rules.
//
// Scope note: M1 (core store), M2 (agents/heartbeats/reaper), and M4
// (messaging + SSE event tail) — see the build order in
// agent-kanban-orchestration-plan-v2-1.md.

import { Hono } from "jsr:@hono/hono";
import { streamSSE } from "jsr:@hono/hono/streaming";
import { timingSafeEqual } from "jsr:@std/crypto/timing-safe-equal";
import { getKv } from "./kv.ts";
import { mcpFetch } from "./mcp.ts";
import {
  archiveBoard,
  claimCard,
  claimNextCard,
  completeCard,
  createBoard,
  createCard,
  getCard,
  heartbeat,
  listAgents,
  listBoardSummaries,
  listCards,
  listEvents,
  moveCard,
  registerAgent,
  releaseCard,
  resolveBoard,
  sendMessage,
  startReaper,
  updateCardProgress,
} from "./service.ts";
import type { AgentStatus, Board, CardStatus } from "./types.ts";

export const orchestrationApp = new Hono<{ Variables: { board: Board } }>();

// Single shared bearer token (plan section 6/9) — opt-in via env var so
// local development doesn't need one set. If ORCHESTRATION_TOKEN is set,
// every request must carry it. Compared timing-safely: a plain !== leaks
// how many leading bytes matched, which is what lets a token be guessed
// byte by byte if this were ever exposed off-loopback.
function bearerMatches(header: string, token: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(header);
  const b = enc.encode(`Bearer ${token}`);
  // timingSafeEqual throws on unequal lengths rather than returning false.
  // Bailing early here only reveals the token's length, not its bytes.
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

orchestrationApp.use("*", async (c, next) => {
  const token = Deno.env.get("ORCHESTRATION_TOKEN");
  if (token && !bearerMatches(c.req.header("authorization") ?? "", token)) {
    return c.text("unauthorized", 401);
  }
  await next();
});

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

const CARD_STATUSES: CardStatus[] = ["backlog", "ready", "in_progress", "review", "done", "blocked"];

// MCP Streamable HTTP endpoint (plan section 5) — a repo's .mcp.json points
// here with its own ?board=<slug>, e.g.
// http://localhost:PORT/api/orchestration/mcp?board=egg-hunt. Handles
// GET (SSE stream), POST (JSON-RPC calls), and DELETE (session teardown) —
// mcp.ts creates a fresh stateless server+transport per request.
orchestrationApp.all("/mcp", async (c) => {
  return await mcpFetch(c.req.raw, c.req.query("board") || undefined);
});

// Resolves :board (slug or ULID) once per request and 404s cleanly if it
// doesn't exist, so every handler below can assume `board` is real.
orchestrationApp.use("/boards/:board/*", async (c, next) => {
  const kv = await getKv();
  const board = await resolveBoard(kv, c.req.param("board"));
  if (!board) return c.text(`unknown board: ${c.req.param("board")}`, 404);
  c.set("board", board);
  return next();
});

orchestrationApp.post("/boards", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const result = await createBoard(kv, {
    slug: typeof body.slug === "string" ? body.slug : "",
    title: typeof body.title === "string" ? body.title : "",
    description: typeof body.description === "string" ? body.description : undefined,
    leaseMs: typeof body.leaseMs === "number" ? body.leaseMs : undefined,
    heartbeatMs: typeof body.heartbeatMs === "number" ? body.heartbeatMs : undefined,
    eventRetentionMs: typeof body.eventRetentionMs === "number" ? body.eventRetentionMs : undefined,
    maxInFlightPerAgent: typeof body.maxInFlightPerAgent === "number" ? body.maxInFlightPerAgent : undefined,
  });
  if ("error" in result) return c.text(result.error, 400);
  return c.json(result, 201);
});

orchestrationApp.get("/boards", async (c) => {
  const kv = await getKv();
  return c.json(await listBoardSummaries(kv));
});

orchestrationApp.get("/boards/:board", (c) => {
  return c.json(c.get("board"));
});

orchestrationApp.post("/boards/:board/archive", async (c) => {
  const kv = await getKv();
  const board = c.get("board");
  const archived = await archiveBoard(kv, board.id);
  return archived ? c.json(archived) : c.text("archive failed, retry", 409);
});

orchestrationApp.post("/boards/:board/agents", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  if (typeof body.name !== "string" || !body.name.trim()) return c.text("name is required", 400);
  const agent = await registerAgent(kv, board.id, {
    name: body.name,
    role: typeof body.role === "string" ? body.role : "worker",
    meta: typeof body.meta === "object" && body.meta !== null ? (body.meta as Record<string, string>) : undefined,
  });
  return c.json(agent, 201);
});

orchestrationApp.get("/boards/:board/agents", async (c) => {
  const kv = await getKv();
  const board = c.get("board");
  return c.json(await listAgents(kv, board.id));
});

orchestrationApp.post("/boards/:board/agents/:id/heartbeat", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  const status = typeof body.status === "string" ? (body.status as AgentStatus) : undefined;
  try {
    return c.json(await heartbeat(kv, board.id, c.req.param("id"), status));
  } catch (err) {
    return c.text(String(err instanceof Error ? err.message : err), 404);
  }
});

orchestrationApp.get("/boards/:board/cards", async (c) => {
  const kv = await getKv();
  const board = c.get("board");
  const status = c.req.query("status");
  const assignee = c.req.query("assignee");
  const cards = await listCards(kv, board.id, {
    status: status && CARD_STATUSES.includes(status as CardStatus) ? (status as CardStatus) : undefined,
    assignee: assignee || undefined,
  });
  return c.json(cards);
});

orchestrationApp.post("/boards/:board/cards", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  if (typeof body.title !== "string" || !body.title.trim()) return c.text("title is required", 400);
  if (typeof body.description !== "string") return c.text("description is required", 400);
  try {
    const card = await createCard(kv, board.id, {
      title: body.title,
      description: body.description,
      priority: typeof body.priority === "number" ? body.priority : undefined,
      dependsOn: parseStringArray(body.dependsOn),
      fileScope: parseStringArray(body.fileScope),
      acceptance: parseStringArray(body.acceptance),
    });
    return c.json(card, 201);
  } catch (err) {
    return c.text(String(err instanceof Error ? err.message : err), 400);
  }
});

orchestrationApp.get("/boards/:board/cards/:id", async (c) => {
  const kv = await getKv();
  const board = c.get("board");
  const card = await getCard(kv, board.id, c.req.param("id"));
  return card ? c.json(card) : c.text("unknown card", 404);
});

orchestrationApp.post("/boards/:board/cards/:id/claim", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  if (!agentId) return c.text("agentId is required", 400);
  const result = await claimCard(kv, board.id, agentId, c.req.param("id"));
  return result.ok ? c.json(result.card) : c.json(result, 409);
});

// Not in the plan's REST table (which lists per-card /claim only) but the
// service layer's claimNextCard is the primary primitive agents use via
// MCP (M3) — exposing it here too costs nothing and gives REST/orchestrator
// scripts the same "just give me the best eligible card" entry point.
orchestrationApp.post("/boards/:board/claim-next", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  if (!agentId) return c.text("agentId is required", 400);
  const result = await claimNextCard(kv, board.id, agentId);
  return result.ok ? c.json(result.card) : c.json(result, 409);
});

orchestrationApp.post("/boards/:board/cards/:id/progress", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  const note = typeof body.note === "string" ? body.note : "";
  if (!agentId) return c.text("agentId is required", 400);
  try {
    const card = await updateCardProgress(kv, board.id, c.req.param("id"), agentId, note);
    return c.json(card);
  } catch (err) {
    return c.text(String(err instanceof Error ? err.message : err), 409);
  }
});

orchestrationApp.post("/boards/:board/cards/:id/move", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  const status = body.status;
  if (!agentId) return c.text("agentId is required", 400);
  if (typeof status !== "string" || !CARD_STATUSES.includes(status as CardStatus)) return c.text("invalid status", 400);
  try {
    const card = await moveCard(kv, board.id, c.req.param("id"), agentId, status as CardStatus, typeof body.detail === "string" ? body.detail : undefined);
    return c.json(card);
  } catch (err) {
    return c.text(String(err instanceof Error ? err.message : err), 409);
  }
});

orchestrationApp.post("/boards/:board/cards/:id/complete", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  const result = typeof body.result === "string" ? body.result : "";
  if (!agentId) return c.text("agentId is required", 400);
  try {
    const card = await completeCard(kv, board.id, c.req.param("id"), agentId, result, typeof body.branch === "string" ? body.branch : undefined);
    return c.json(card);
  } catch (err) {
    return c.text(String(err instanceof Error ? err.message : err), 409);
  }
});

orchestrationApp.post("/boards/:board/cards/:id/release", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!agentId) return c.text("agentId is required", 400);
  try {
    const card = await releaseCard(kv, board.id, c.req.param("id"), agentId, reason);
    return c.json(card);
  } catch (err) {
    return c.text(String(err instanceof Error ? err.message : err), 409);
  }
});

orchestrationApp.post("/boards/:board/messages", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const kv = await getKv();
  const board = c.get("board");
  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";
  const text = typeof body.body === "string" ? body.body : "";
  if (!from) return c.text("from is required", 400);
  if (!to) return c.text("to is required", 400);
  if (!text) return c.text("body is required", 400);
  try {
    const message = await sendMessage(kv, board.id, { from, to, body: text, cardId: typeof body.cardId === "string" ? body.cardId : undefined });
    return c.json(message, 201);
  } catch (err) {
    return c.text(String(err instanceof Error ? err.message : err), 400);
  }
});

orchestrationApp.get("/boards/:board/events", async (c) => {
  const kv = await getKv();
  const board = c.get("board");
  const since = c.req.query("since") || undefined;
  const events = await listEvents(kv, board.id, since);
  return c.json(events);
});

// SSE tail (plan section 6) — no in-process event bus for orchestration
// (unlike kraken's bus.ts, since all state here lives in Deno KV, not
// in-memory), so this polls listEvents on a short interval starting from
// "now," pushing anything new. Pull-based delivery is an accepted latency
// tradeoff per the plan's own risk notes; a human tailing a board isn't the
// same low-latency requirement as an agent's own MCP-side polling loop.
const SSE_POLL_MS = 1000;

orchestrationApp.get("/boards/:board/events/stream", (c) => {
  const board = c.get("board");
  const initialSince = c.req.query("since") || undefined;
  return streamSSE(c, async (stream) => {
    const kv = await getKv();
    // No ?since= given: tail from *now*, not the full history — a client
    // that wants replay-from-a-point passes since explicitly (same param
    // as GET /events).
    let cursor = initialSince;
    if (cursor === undefined) {
      const existing = await listEvents(kv, board.id);
      if (existing.length > 0) cursor = existing[existing.length - 1].id;
    }
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    while (!closed) {
      const events = await listEvents(kv, board.id, cursor);
      for (const event of events) {
        await stream.writeSSE({ event: "board.event", data: JSON.stringify(event), id: event.id });
        cursor = event.id;
      }
      await new Promise((resolve) => setTimeout(resolve, SSE_POLL_MS));
    }
  });
});

// routes.ts is imported exactly once, at server startup (main.ts) — this
// top-level await means the server doesn't start accepting requests until
// KV is open, and boots the lease/liveness reaper alongside it.
startReaper(await getKv());

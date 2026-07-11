// REST surface for the orchestration server. Mounted at /api/orchestration
// (see main.ts) — so e.g. board list is GET /api/orchestration/boards.
// Every handler is a thin wrapper over service.ts; there's no logic here
// beyond parsing/validating the request and shaping the response, so the
// MCP tool layer (M3) can call the exact same service functions later
// without duplicating any coordination rules.
//
// Scope note: M1 only. Agent registration/roster (M2), messaging, and the
// SSE event tail (M4) are deliberately not wired up yet — see the build
// order in agent-kanban-orchestration-plan-v2-1.md.

import { Hono } from "jsr:@hono/hono";
import { getKv } from "./kv.ts";
import {
  archiveBoard,
  claimCard,
  claimNextCard,
  completeCard,
  createBoard,
  createCard,
  getCard,
  listBoards,
  listCards,
  listEvents,
  moveCard,
  releaseCard,
  resolveBoard,
  updateCardProgress,
} from "./service.ts";
import type { Board, CardStatus } from "./types.ts";

export const orchestrationApp = new Hono<{ Variables: { board: Board } }>();

// Single shared bearer token (plan section 6/9) — opt-in via env var so
// local development doesn't need one set. If ORCHESTRATION_TOKEN is set,
// every request must carry it.
orchestrationApp.use("*", async (c, next) => {
  const token = Deno.env.get("ORCHESTRATION_TOKEN");
  if (!token) return next();
  const header = c.req.header("authorization") ?? "";
  if (header !== `Bearer ${token}`) return c.text("unauthorized", 401);
  return next();
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
  });
  if ("error" in result) return c.text(result.error, 400);
  return c.json(result, 201);
});

orchestrationApp.get("/boards", async (c) => {
  const kv = await getKv();
  const boards = await listBoards(kv);
  // Counts are cheap enough at M1 scale to compute per-request; revisit if
  // board/card volume ever makes this worth caching.
  const withCounts = await Promise.all(boards.map(async (board) => {
    const cards = await listCards(kv, board.id);
    const openCount = cards.filter((c) => c.status !== "done").length;
    return { ...board, openCardCount: openCount, cardCount: cards.length };
  }));
  return c.json(withCounts);
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
  const card = await createCard(kv, board.id, {
    title: body.title,
    description: body.description,
    priority: typeof body.priority === "number" ? body.priority : undefined,
    dependsOn: parseStringArray(body.dependsOn),
    fileScope: parseStringArray(body.fileScope),
    acceptance: parseStringArray(body.acceptance),
  });
  return c.json(card, 201);
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

orchestrationApp.get("/boards/:board/events", async (c) => {
  const kv = await getKv();
  const board = c.get("board");
  const since = c.req.query("since") || undefined;
  const events = await listEvents(kv, board.id, since);
  return c.json(events);
});

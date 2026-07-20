import { Hono } from "jsr:@hono/hono";
import { streamSSE } from "jsr:@hono/hono/streaming";
import type { Effort, Model, Recurrence, RecurrenceUnit, Snapshot } from "../../src/kraken/types.ts";
import { state } from "./state.ts";
import { initPersistedState } from "./state-store.ts";
import { subscribe } from "./bus.ts";
import { applyAltFix, approveEvent, denyEvent, retryEvent } from "./resolutions.ts";
import { deleteSession, renameSession, sendMessage, stopSession, togglePause } from "./session-actions.ts";
import {
  cancelMove,
  cancelPendingEffort,
  cancelPendingModel,
  deleteTeam,
  makeLead,
  queueEffortChange,
  queueModelChange,
  queueMove,
} from "./team-actions.ts";
import { approveArtifact, requestChanges } from "./review-actions.ts";
import { revokeGrant } from "./grant-actions.ts";
import { spawnFromBody, spawnIntoTeam, startWorkers } from "./spawn-actions.ts";
import { addMcpConfig, deleteMcpConfig, updateMcpConfig } from "./mcp-actions.ts";
import { addSkill, addSubagent, deleteSkill, deleteSubagent, updateSkill, updateSubagent } from "./library-actions.ts";
import { createSchedule, deleteSchedule, initSchedules, setCatchUpMissedSchedules, startScheduler } from "./schedule-actions.ts";
import { clearAnthropicApiKey, initApiKey, setAnthropicApiKey } from "./api-key-actions.ts";
import { clearGeminiApiKey, initGeminiApiKey, setGeminiApiKey } from "./gemini-key-actions.ts";
import { initDefaultDirectory, setDefaultDirectory } from "./general-settings-actions.ts";
import { listDirectories } from "./dir-listing.ts";
import { undoAction } from "./undo.ts";
import { EFFORTS, MODELS, parseEffort, parseModel, parseStringArray, parseStringRecord, parseTransport } from "./parse-body.ts";

// No seed data and no simulator — every session in state now originates from
// a real spawn (POST /sessions), backed by a live Claude Agent SDK process.
export const krakenApp = new Hono();

krakenApp.get("/snapshot", (c) => c.json<Snapshot>(state));

krakenApp.get("/dirs", async (c) => {
  const prefix = c.req.query("prefix") ?? "";
  return c.json(await listDirectories(prefix));
});

krakenApp.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const unsubscribe = subscribe(({ event, data }) => {
      void stream.writeSSE({ event, data: JSON.stringify(data) });
    });
    stream.onAbort(unsubscribe);
    await new Promise<void>((resolve) => stream.onAbort(resolve));
  }));

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const RECURRENCE_UNITS: RecurrenceUnit[] = ["minutes", "hours", "days"];

// Returns null for both "no recurrence" (value is null/undefined) and "bad
// recurrence" — the caller distinguishes those by checking whether the raw
// value was nullish before treating a null result as a validation error.
function parseRecurrence(value: unknown): Recurrence | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  if (v.kind === "interval") {
    if (!RECURRENCE_UNITS.includes(v.unit as RecurrenceUnit)) return null;
    const every = typeof v.every === "number" ? Math.floor(v.every) : NaN;
    if (!Number.isFinite(every) || every < 1) return null;
    return { kind: "interval", unit: v.unit as RecurrenceUnit, every };
  }

  if (v.kind === "weekly") {
    const daysOfWeek = Array.isArray(v.daysOfWeek)
      ? v.daysOfWeek.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
      : [];
    if (daysOfWeek.length === 0) return null;
    const hour = typeof v.hour === "number" ? v.hour : NaN;
    const minute = typeof v.minute === "number" ? v.minute : NaN;
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
    return { kind: "weekly", daysOfWeek, hour, minute };
  }

  return null;
}

krakenApp.post("/events/:id/approve", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const scope = body.scope === "session" ? "session" : "once";
  approveEvent(c.req.param("id"), scope);
  return c.body(null, 204);
});

krakenApp.post("/events/:id/deny", (c) => {
  denyEvent(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/events/:id/retry", (c) => {
  retryEvent(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/events/:id/alt-fix", (c) => {
  applyAltFix(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/toggle-pause", (c) => {
  togglePause(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/stop", (c) => {
  stopSession(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/rename", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.text("name is required", 400);
  renameSession(c.req.param("id"), name);
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/messages", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const text = typeof body.text === "string" ? body.text : "";
  sendMessage(c.req.param("id"), text);
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/queue-model", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (MODELS.includes(body.model as Model)) {
    queueModelChange(c.req.param("id"), body.model as Model);
  }
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/queue-effort", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (EFFORTS.includes(body.effort as Effort)) {
    queueEffortChange(c.req.param("id"), body.effort as Effort);
  }
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/cancel-pending", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (body.kind === "effort") {
    cancelPendingEffort(c.req.param("id"));
  } else {
    cancelPendingModel(c.req.param("id"));
  }
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/queue-move", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const target = typeof body.target === "string" ? body.target : null;
  queueMove(c.req.param("id"), target);
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/cancel-move", (c) => {
  cancelMove(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/sessions/:id/make-lead", (c) => {
  makeLead(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.delete("/sessions/:id", (c) => {
  deleteSession(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.delete("/teams/:id", (c) => {
  deleteTeam(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/teams/:id/start-workers", (c) => {
  startWorkers(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/events/:id/approve-artifact", (c) => {
  approveArtifact(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/events/:id/request-changes", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const note = typeof body.note === "string" ? body.note : "";
  requestChanges(c.req.param("id"), note);
  return c.body(null, 204);
});

krakenApp.post("/grants/:id/revoke", (c) => {
  revokeGrant(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/sessions", async (c) => {
  const body = await readJsonBody(c.req.raw);

  if (body.mode === "existing" && typeof body.teamId === "string") {
    const task = typeof body.task === "string" ? body.task : "";
    spawnIntoTeam(task, body.teamId, parseModel(body.model), parseEffort(body.effort));
    return c.body(null, 204);
  }

  spawnFromBody(body);
  return c.body(null, 204);
});

krakenApp.post("/schedules", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const runAt = typeof body.runAt === "number" ? body.runAt : NaN;
  if (!label) return c.text("label is required", 400);
  if (!Number.isFinite(runAt) || runAt <= Date.now()) return c.text("runAt must be a time in the future", 400);

  const payload = body.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== "object") return c.text("payload is required", 400);

  if (payload.kind === "message") {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) return c.text("unknown session", 400);
    if (!text) return c.text("message text is required", 400);
    createSchedule(label, runAt, { kind: "message", sessionId, sessionLabel: session.name, text });
    return c.body(null, 204);
  }

  if (payload.kind === "spawn") {
    const spawnBody = payload.body as Record<string, unknown> | undefined;
    if (!spawnBody || (spawnBody.mode !== "new" && spawnBody.mode !== "solo")) {
      return c.text("spawn payload must have mode \"new\" or \"solo\"", 400);
    }
    const recurrence = parseRecurrence(body.recurrence);
    if (body.recurrence != null && recurrence === null) return c.text("invalid recurrence", 400);
    createSchedule(label, runAt, { kind: "spawn", body: spawnBody }, recurrence);
    return c.body(null, 204);
  }

  return c.text("unknown payload kind", 400);
});

krakenApp.delete("/schedules/:id", (c) => {
  deleteSchedule(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.put("/settings", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (typeof body.catchUpMissedSchedules === "boolean") {
    setCatchUpMissedSchedules(body.catchUpMissedSchedules);
  }
  if (typeof body.defaultDirectory === "string") {
    setDefaultDirectory(body.defaultDirectory);
  }
  return c.body(null, 204);
});

krakenApp.post("/skills", async (c) => {
  const body = await readJsonBody(c.req.raw);
  addSkill({
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : "",
    instructions: typeof body.instructions === "string" ? body.instructions : "",
  });
  return c.body(null, 204);
});

krakenApp.put("/skills/:id", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const updated = updateSkill(c.req.param("id"), {
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : "",
    instructions: typeof body.instructions === "string" ? body.instructions : "",
  });
  return updated ? c.body(null, 204) : c.text("unknown skill", 404);
});

krakenApp.delete("/skills/:id", (c) => {
  deleteSkill(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/subagents", async (c) => {
  const body = await readJsonBody(c.req.raw);
  addSubagent({
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : "",
    systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : "",
    model: parseModel(body.model),
    effort: parseEffort(body.effort),
  });
  return c.body(null, 204);
});

krakenApp.put("/subagents/:id", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const updated = updateSubagent(c.req.param("id"), {
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : "",
    systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : "",
    model: parseModel(body.model),
    effort: parseEffort(body.effort),
  });
  return updated ? c.body(null, 204) : c.text("unknown subagent", 404);
});

krakenApp.delete("/subagents/:id", (c) => {
  deleteSubagent(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/mcp-configs", async (c) => {
  const body = await readJsonBody(c.req.raw);
  addMcpConfig({
    name: typeof body.name === "string" ? body.name : "",
    transport: parseTransport(body.transport),
    command: typeof body.command === "string" ? body.command : "",
    args: parseStringArray(body.args),
    env: parseStringRecord(body.env),
    url: typeof body.url === "string" ? body.url : "",
    headers: parseStringRecord(body.headers),
  });
  return c.body(null, 204);
});

krakenApp.put("/mcp-configs/:id", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const updated = updateMcpConfig(c.req.param("id"), {
    name: typeof body.name === "string" ? body.name : "",
    transport: parseTransport(body.transport),
    command: typeof body.command === "string" ? body.command : "",
    args: parseStringArray(body.args),
    env: parseStringRecord(body.env),
    url: typeof body.url === "string" ? body.url : "",
    headers: parseStringRecord(body.headers),
  });
  return updated ? c.body(null, 204) : c.body(null, 404);
});

krakenApp.delete("/mcp-configs/:id", (c) => {
  deleteMcpConfig(c.req.param("id"));
  return c.body(null, 204);
});

krakenApp.post("/undo/:key", (c) => {
  undoAction(c.req.param("key"));
  return c.body(null, 204);
});

krakenApp.post("/settings/api-key", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : "";
  const result = await setAnthropicApiKey(key);
  if (result) return c.json(result, 400);
  return c.body(null, 204);
});

krakenApp.delete("/settings/api-key", async (c) => {
  await clearAnthropicApiKey();
  return c.body(null, 204);
});

krakenApp.post("/settings/gemini-key", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : "";
  const result = await setGeminiApiKey(key);
  if (result) return c.json(result, 400);
  return c.body(null, 204);
});

krakenApp.delete("/settings/gemini-key", async (c) => {
  await clearGeminiApiKey();
  return c.body(null, 204);
});

// routes.ts is imported exactly once, at server startup (main.ts) — these
// top-level awaits mean main.ts's Deno.serve only starts accepting
// requests after persisted state and schedules are loaded, so GET
// /snapshot never races an empty-then-populated window. State restores
// first: schedule reconciliation may reference restored sessions by id.
await initPersistedState();
await initApiKey();
await initGeminiApiKey();
await initDefaultDirectory();
await initSchedules();
startScheduler();

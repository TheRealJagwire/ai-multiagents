import { Hono } from "jsr:@hono/hono";
import { streamSSE } from "jsr:@hono/hono/streaming";
import type { Effort, Model, Snapshot } from "../../src/switchboard/types.ts";
import { state } from "./state.ts";
import { subscribe } from "./bus.ts";
import { applyAltFix, approveEvent, denyEvent, retryEvent } from "./resolutions.ts";
import { sendMessage, stopSession, togglePause } from "./session-actions.ts";
import {
  cancelMove,
  cancelPendingEffort,
  cancelPendingModel,
  makeLead,
  queueEffortChange,
  queueModelChange,
  queueMove,
} from "./team-actions.ts";
import { approveArtifact, requestChanges } from "./review-actions.ts";
import { revokeGrant } from "./grant-actions.ts";
import { spawnIntoTeam, spawnSolo, spawnTeam } from "./spawn-actions.ts";
import { undoAction } from "./undo.ts";

const MODELS: Model[] = ["haiku", "sonnet", "opus"];
const EFFORTS: Effort[] = ["low", "medium", "high"];

function parseModel(value: unknown): Model {
  return MODELS.includes(value as Model) ? (value as Model) : "sonnet";
}

function parseEffort(value: unknown): Effort {
  return EFFORTS.includes(value as Effort) ? (value as Effort) : "medium";
}

// No seed data and no simulator — every session in state now originates from
// a real spawn (POST /sessions), backed by a live Managed Agents session.
export const switchboardApp = new Hono();

switchboardApp.get("/snapshot", (c) => c.json<Snapshot>(state));

switchboardApp.get("/events", (c) =>
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

switchboardApp.post("/events/:id/approve", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const scope = body.scope === "session" ? "session" : "once";
  approveEvent(c.req.param("id"), scope);
  return c.body(null, 204);
});

switchboardApp.post("/events/:id/deny", (c) => {
  denyEvent(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/events/:id/retry", (c) => {
  retryEvent(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/events/:id/alt-fix", (c) => {
  applyAltFix(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/toggle-pause", (c) => {
  togglePause(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/stop", (c) => {
  stopSession(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/messages", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const text = typeof body.text === "string" ? body.text : "";
  sendMessage(c.req.param("id"), text);
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/queue-model", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (MODELS.includes(body.model as Model)) {
    queueModelChange(c.req.param("id"), body.model as Model);
  }
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/queue-effort", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (EFFORTS.includes(body.effort as Effort)) {
    queueEffortChange(c.req.param("id"), body.effort as Effort);
  }
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/cancel-pending", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (body.kind === "effort") {
    cancelPendingEffort(c.req.param("id"));
  } else {
    cancelPendingModel(c.req.param("id"));
  }
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/queue-move", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const target = typeof body.target === "string" ? body.target : null;
  queueMove(c.req.param("id"), target);
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/cancel-move", (c) => {
  cancelMove(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/sessions/:id/make-lead", (c) => {
  makeLead(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/events/:id/approve-artifact", (c) => {
  approveArtifact(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/events/:id/request-changes", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const note = typeof body.note === "string" ? body.note : "";
  requestChanges(c.req.param("id"), note);
  return c.body(null, 204);
});

switchboardApp.post("/grants/:id/revoke", (c) => {
  revokeGrant(c.req.param("id"));
  return c.body(null, 204);
});

switchboardApp.post("/sessions", async (c) => {
  const body = await readJsonBody(c.req.raw);

  if (body.mode === "new") {
    const teamName = typeof body.teamName === "string" ? body.teamName : "";
    const goal = typeof body.goal === "string" ? body.goal : "";
    const dir = typeof body.dir === "string" ? body.dir.trim() : "";
    const baseRef = typeof body.baseRef === "string" && body.baseRef.trim() ? body.baseRef.trim() : "HEAD";
    const members = Array.isArray(body.members)
      ? body.members.map((m) => {
        const member = m as Record<string, unknown>;
        return {
          task: typeof member.task === "string" ? member.task : "",
          model: parseModel(member.model),
          effort: parseEffort(member.effort),
        };
      })
      : [];
    spawnTeam(teamName, goal, dir, baseRef, members);
    return c.body(null, 204);
  }

  const task = typeof body.task === "string" ? body.task : "";
  const model = parseModel(body.model);
  const effort = parseEffort(body.effort);

  if (body.mode === "existing" && typeof body.teamId === "string") {
    spawnIntoTeam(task, body.teamId, model, effort);
    return c.body(null, 204);
  }

  const dir = typeof body.dir === "string" ? body.dir.trim() : "";
  const baseRef = typeof body.baseRef === "string" && body.baseRef.trim() ? body.baseRef.trim() : "HEAD";
  spawnSolo(task, model, effort, dir, baseRef);
  return c.body(null, 204);
});

switchboardApp.post("/undo/:key", (c) => {
  undoAction(c.req.param("key"));
  return c.body(null, 204);
});

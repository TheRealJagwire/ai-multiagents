// The Google ADK (Gemini) session driver — the sibling of
// agent-sessions.ts, selected in spawn-actions.ts when the session's model
// is a Gemini one (providerOf). Same external contract: registers an
// AgentSessionHandle, feeds the same transcript/feed/status mutations, and
// reuses the shared approval registry so resolutions.ts works unchanged.
//
// Structural difference from the Claude driver: the Claude SDK runs one
// long-lived query() over a message stream, while ADK runs one
// runner.runAsync() per user turn against a session service that carries
// the history. That per-turn shape is what makes setModel trivial here —
// the next turn simply builds its runner around the new model.

import { type BaseTool, Gemini, InMemorySessionService, LlmAgent, Runner } from "npm:@google/adk@^1.3.0";
import type { Effort, Model } from "../../src/switchboard/types.ts";
import { pushFeedEvent, pushSessionPatch, pushTranscriptMessage } from "./mutations.ts";
import { registerAgentSession } from "./agent-registry.ts";
import { state } from "./state.ts";
import { AsyncQueue } from "./async-queue.ts";
import { beginAssistantMessage, checkForSpecPlan, collectTurnText, flushTurnSummary } from "./turn-report.ts";
import { beginPlanning, buildCodingTools, clearPlanPhase, settlePendingGates } from "./adk-tools.ts";
import { buildMcpToolsets } from "./adk-mcp.ts";
import { WORKER_SYSTEM_PROMPT, type SpawnOptions } from "./agent-sessions.ts";
import { getGeminiApiKey } from "./gemini-key-actions.ts";

// UI model names → real Gemini model IDs (verified against @google/adk
// 1.3.0, whose Gemini class defaults to gemini-2.5-flash).
const GEMINI_MODEL_IDS: Partial<Record<Model, string>> = {
  "gemini-flash": "gemini-2.5-flash",
  "gemini-pro": "gemini-2.5-pro",
};

// Approximate USD per input/output token (2.5 Flash and Pro list prices) —
// the cost gauge is best-effort, matching the "roughly what has this cost
// me" purpose it serves in the UI.
const GEMINI_PRICES: Partial<Record<Model, { input: number; output: number }>> = {
  "gemini-flash": { input: 0.30 / 1e6, output: 2.50 / 1e6 },
  "gemini-pro": { input: 1.25 / 1e6, output: 10.00 / 1e6 },
};

const GEMINI_CONTEXT_WINDOW = 1_000_000;

// Effort → Gemini thinking budget (tokens): low disables thinking, medium
// lets the model decide, high gives it a large budget. Set once at spawn
// (effort is fixed for a session's life, same as the Claude driver).
//
// NOTE: whether ADK-TS forwards generateContentConfig.thinkingConfig to the
// model or strips it is unverified without a live key — the spike's (g) check
// answers this. If it's stripped, this is a harmless no-op (Gemini falls back
// to its default auto-thinking, i.e. today's behavior); if it's honored, the
// effort chip finally means something for Gemini. Either way, no regression.
const THINKING_BUDGET: Record<Effort, number> = { low: 0, medium: -1, high: 24_576 };

const ADK_INSTRUCTION_SUFFIX = "\n\n" +
  "Your tools: read_file, list_dir, grep (read-only), write_file, edit_file, bash (these need the user's " +
  "approval per call, or a session-wide allow). All file paths are relative to your working directory; you " +
  "cannot touch files outside it except through approved bash commands. If a tool returns an error saying " +
  "the user denied it, adjust your approach or explain what you need instead of retrying the same call.";

const ADK_PLAN_MODE_SUFFIX = "\n\n" +
  "You are starting in PLAN MODE. Do not modify anything yet — use the read-only tools (read_file, list_dir, " +
  "grep) to understand the task, then call submit_plan with a clear, concise plan for the user to approve. The " +
  "write/edit/bash tools are blocked until your plan is approved. Once approved, carry it out.";

interface TurnTracker {
  cost: number;
}

// Translates one ADK event into Switchboard state mutations. Exported for
// tests — like agent-sessions.ts's handleMessage, this is pure state logic
// that must not require a live model to verify.
export function translateAdkEvent(sid: string, event: unknown, model: Model, tracker: TurnTracker): void {
  const anyEvent = event as {
    content?: { role?: string; parts?: { text?: string; functionCall?: { name?: string; args?: unknown }; functionResponse?: { name?: string; response?: unknown } }[] };
    partial?: boolean;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const parts = anyEvent.content?.parts ?? [];
  // Streaming interleaves partial text frames with a final aggregated
  // event — only the non-partial frames become transcript entries, or
  // every sentence would appear twice.
  const textParts = parts.filter((p) => p.text && !anyEvent.partial);
  if (textParts.length > 0 && anyEvent.content?.role === "model") {
    beginAssistantMessage(sid);
    for (const part of textParts) {
      pushTranscriptMessage(sid, { k: "text", text: part.text! });
      collectTurnText(sid, part.text!);
    }
  }

  for (const part of parts) {
    if (part.functionCall) {
      const label = part.functionCall.args !== undefined ? JSON.stringify(part.functionCall.args) : "";
      pushTranscriptMessage(sid, { k: "tool", text: `▸ ${part.functionCall.name ?? "tool"}: ${label}` });
    } else if (part.functionResponse) {
      const text = JSON.stringify(part.functionResponse.response ?? "");
      pushTranscriptMessage(sid, { k: "tool", text: text.slice(0, 800) });
    }
  }

  const usage = anyEvent.usageMetadata;
  if (usage) {
    const input = usage.promptTokenCount ?? 0;
    const output = usage.candidatesTokenCount ?? 0;
    const prices = GEMINI_PRICES[model];
    if (prices) tracker.cost += input * prices.input + output * prices.output;
    if (input > 0) {
      pushSessionPatch(sid, { ctx: Math.min(100, Math.round((input / GEMINI_CONTEXT_WINDOW) * 100)) });
    }
  }
}

export async function spawnAdkSession(sid: string, task: string, opts: SpawnOptions): Promise<void> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    pushSessionPatch(sid, { status: "error", statusLine: "No Gemini API key configured", phase: "blocked" });
    pushFeedEvent({ sid, kind: "error", own: false, verb: "can't start: no Gemini API key — add one in Settings › General" });
    return;
  }

  const queue = new AsyncQueue<string>();
  const sessionService = new InMemorySessionService();
  const adkSession = await sessionService.createSession({ appName: "switchboard", userId: sid });

  let model: Model = opts.model;
  let current: AbortController | null = null;
  let closed = false;
  // Populated after the async MCP discovery below; close() reads it later so
  // it must be visible in the handle's closure from the start.
  const mcpToolsets: { close: () => Promise<void> }[] = [];

  registerAgentSession(sid, {
    interrupt: () => {
      current?.abort();
      settlePendingGates(sid, "Interrupted by the user.");
      return Promise.resolve();
    },
    close: () => {
      closed = true;
      queue.close();
      current?.abort();
      settlePendingGates(sid, "Session ended.");
      clearPlanPhase(sid);
      for (const toolset of mcpToolsets) toolset.close().catch(() => {});
    },
    // Takes effect at the next turn — each turn builds a fresh runner
    // around the current model, over the same history-carrying session.
    setModel: (m) => {
      model = m;
      return Promise.resolve();
    },
    pushMessage: (text: string) => queue.push(text),
    dir: opts.dir,
    worktreePath: opts.worktreePath,
    branch: opts.branch,
    sessionAllowAll: false,
  });

  if (opts.planFirst) beginPlanning(sid);

  const tracker: TurnTracker = { cost: 0 };
  const tools: BaseTool[] = buildCodingTools({
    sid,
    worktreePath: opts.worktreePath,
    currentSignal: () => current?.signal,
    onSpawnWorker: opts.onSpawnWorker,
    planFirst: opts.planFirst,
  });

  // Discover the session's MCP servers once, up front — the gated wrappers
  // and their toolsets live for the whole session (closed in close() above).
  if (opts.mcpConfigIds.length > 0) {
    pushSessionPatch(sid, { statusLine: "Connecting to MCP servers…" });
    const bundle = await buildMcpToolsets(sid, opts.mcpConfigIds);
    tools.push(...bundle.tools);
    mcpToolsets.push(...bundle.toolsets);
  }
  const instruction = WORKER_SYSTEM_PROMPT + ADK_INSTRUCTION_SUFFIX + (opts.planFirst ? ADK_PLAN_MODE_SUFFIX : "");

  queue.push(task);

  for await (const text of queue) {
    if (closed) break;
    current = new AbortController();
    const signal = current.signal;

    const session = state.sessions.find((s) => s.id === sid);
    if (session && (session.status === "running" || session.status === "idle")) {
      pushSessionPatch(sid, { status: "running", statusLine: "Working…", phase: "executing" });
    }

    try {
      const runner = new Runner({
        appName: "switchboard",
        agent: new LlmAgent({
          name: "switchboard_worker",
          model: new Gemini({ model: GEMINI_MODEL_IDS[model] ?? "gemini-2.5-flash", apiKey }),
          instruction,
          tools,
          generateContentConfig: { thinkingConfig: { thinkingBudget: THINKING_BUDGET[opts.effort] } },
        }),
        sessionService,
      });

      for await (
        const event of runner.runAsync({
          userId: sid,
          sessionId: adkSession.id,
          newMessage: { role: "user", parts: [{ text }] },
          abortSignal: signal,
        })
      ) {
        if (signal.aborted) break;
        translateAdkEvent(sid, event, model, tracker);
      }

      if (!signal.aborted) {
        if (tracker.cost > 0) pushSessionPatch(sid, { cost: tracker.cost });
        flushTurnSummary(sid);
        checkForSpecPlan(sid).catch(() => {});
        idleTransition(sid, "Idle — ready for the next message");
      }
    } catch (err) {
      if (!signal.aborted) {
        pushFeedEvent({ sid, kind: "error", own: false, verb: `turn failed: ${String(err)}` });
        idleTransition(sid, "Idle — last turn ended with an error");
      }
    }
    current = null;
  }
}

// Same guard as the Claude driver's result handler: only a running session
// lands on idle — an interrupt-triggered end can't clobber paused/stopped,
// and a pending-approval "waiting" stays waiting.
function idleTransition(sid: string, statusLine: string): void {
  const session = state.sessions.find((s) => s.id === sid);
  if (session?.status === "running") {
    pushSessionPatch(sid, { status: "idle", statusLine, phase: "reviewing" });
  }
}

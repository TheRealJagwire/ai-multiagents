import { createSdkMcpServer, query, tool } from "npm:@anthropic-ai/claude-agent-sdk@^0.3.204";
import type {
  CanUseTool,
  McpServerConfig,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "npm:@anthropic-ai/claude-agent-sdk@^0.3.204";
import { z } from "npm:zod@^4.4.3";
import type { Effort, Model } from "../../src/switchboard/types.ts";
import { pushFeedEvent, pushSessionPatch, pushTranscriptMessage } from "./mutations.ts";
import { getAgentSession, registerAgentSession, registerPendingApproval } from "./agent-registry.ts";
import { state } from "./state.ts";

// Looks up each id against the live config library rather than snapshotting
// configs at spawn time — a config deleted between spawn and lookup is just
// silently skipped (the session still starts, minus that server) rather
// than failing the whole spawn.
function buildMcpServers(mcpConfigIds: string[]): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};
  for (const id of mcpConfigIds) {
    const config = state.mcpConfigs.find((c) => c.id === id);
    if (!config) continue;

    if (config.transport === "stdio") {
      servers[config.name] = {
        type: "stdio",
        command: config.command,
        ...(config.args.length ? { args: config.args } : {}),
        ...(Object.keys(config.env).length ? { env: config.env } : {}),
      };
    } else {
      servers[config.name] = {
        type: config.transport,
        url: config.url,
        ...(Object.keys(config.headers).length ? { headers: config.headers } : {}),
      };
    }
  }
  return servers;
}

export type SpawnWorkerResult = { ok: true } | { ok: false; error: string };

// An in-process MCP server (no subprocess, no network) exposing a single
// tool that lets an "autonomous"-mode team lead spawn its own teammates.
// The actual spawning logic lives in spawn-actions.ts and is handed in as a
// plain callback — see SpawnOptions.onSpawnWorker below for why.
function buildCoordinatorServer(onSpawnWorker: (task: string) => Promise<SpawnWorkerResult>): McpServerConfig {
  return createSdkMcpServer({
    name: "switchboard",
    tools: [
      tool(
        "spawn_worker",
        "Spawn a new worker agent session as part of this team. The worker gets its own git worktree " +
          "branched from your current branch, so commit anything it needs to see before calling this.",
        { task: z.string().describe("A clear, self-contained description of what this worker should do.") },
        async ({ task }) => {
          const result = await onSpawnWorker(task);
          return {
            content: [{
              type: "text" as const,
              text: result.ok ? `Worker spawned for: ${task}` : `Failed to spawn worker: ${result.error}`,
            }],
          };
        },
      ),
    ],
  });
}

const WORKER_SYSTEM_PROMPT =
  "You are an autonomous worker agent running inside Switchboard, a multi-agent orchestration UI. " +
  "Work through the task you were given, narrate meaningful progress in plain language, and use your " +
  "tools to do real work in the git worktree you've been given as your working directory. " +
  "Always end your final reply to a request with a concise one-to-two sentence summary of exactly what " +
  "you did — it's shown on its own in an activity feed, so it needs to stand alone without the rest of " +
  "the conversation.";

// The SDK's own bundled `claude` binary lives inside node_modules and, in
// the packaged .app, only exists as a temp copy lazily extracted from the
// compiled binary at spawn time — that extraction can produce a copy that
// fails to launch (wrong permissions/signing), independent of any real
// libc/arch mismatch. Prefer whatever `claude` the user already has on
// PATH (the same one `claude login` authenticates) and only fall back to
// the SDK's bundled copy if none is found.
let claudeExecutablePromise: Promise<string | undefined> | null = null;
function resolveClaudeExecutable(): Promise<string | undefined> {
  if (!claudeExecutablePromise) {
    claudeExecutablePromise = (async () => {
      try {
        const { code, stdout } = await new Deno.Command("which", { args: ["claude"], stdout: "piped" }).output();
        if (code !== 0) return undefined;
        const path = new TextDecoder().decode(stdout).trim();
        return path || undefined;
      } catch {
        return undefined;
      }
    })();
  }
  return claudeExecutablePromise;
}

// Pull-based async queue so query() can be called once with a long-lived
// AsyncIterable as its prompt — later code pushes follow-up user messages
// (chat replies, retries, "Continue.") into the same running session instead
// of starting a new query() per message.
class MessageQueue implements AsyncIterable<SDKUserMessage> {
  #buffer: SDKUserMessage[] = [];
  #waiters: ((msg: SDKUserMessage | null) => void)[] = [];
  #closed = false;

  push(text: string): void {
    if (this.#closed) return;
    const msg = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    } as SDKUserMessage;
    const waiter = this.#waiters.shift();
    if (waiter) waiter(msg);
    else this.#buffer.push(msg);
  }

  close(): void {
    this.#closed = true;
    while (this.#waiters.length) this.#waiters.shift()!(null);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      if (this.#buffer.length) {
        yield this.#buffer.shift()!;
        continue;
      }
      if (this.#closed) return;
      const msg = await new Promise<SDKUserMessage | null>((resolve) => this.#waiters.push(resolve));
      if (msg === null) return;
      yield msg;
    }
  }
}

export interface SpawnOptions {
  dir: string;
  worktreePath: string;
  branch: string;
  model: Model;
  effort: Effort;
  mcpConfigIds: string[];
  // Only set when spawning the lead of an "autonomous" team — regular
  // workers never receive it, so only a lead can grow its own team.
  onSpawnWorker?: (task: string) => Promise<SpawnWorkerResult>;
}

export async function spawnAgentSession(sid: string, task: string, opts: SpawnOptions): Promise<void> {
  const queue = new MessageQueue();

  const canUseTool: CanUseTool = async (toolName, input, callOpts) => {
    const handle = getAgentSession(sid);
    if (handle?.sessionAllowAll) {
      return { behavior: "allow", updatedInput: input };
    }

    const command = typeof input.command === "string" ? input.command : JSON.stringify(input);
    const extra = callOpts as unknown as { title?: string; description?: string; signal: AbortSignal };
    const feedEvent = pushFeedEvent({
      sid,
      kind: "approval",
      own: false,
      verb: `wants to use ${toolName}`,
      command,
      grantPattern: `${toolName} *`,
      why: extra.title ?? extra.description ?? `Requested by the agent (${toolName})`,
    });
    pushTranscriptMessage(sid, { k: "perm", eventId: feedEvent.id });
    pushSessionPatch(sid, { status: "waiting", statusLine: "Waiting for your input", phase: "gated" });

    return await new Promise((resolve) => {
      const settle = (decision: { allow: true } | { allow: false; message: string }) => {
        resolve(decision.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: decision.message });
      };
      registerPendingApproval(feedEvent.id, settle);
      extra.signal.addEventListener("abort", () => settle({ allow: false, message: "Session ended." }));
    });
  };

  const pathToClaudeCodeExecutable = await resolveClaudeExecutable();
  const mcpServers = buildMcpServers(opts.mcpConfigIds);
  if (opts.onSpawnWorker) {
    mcpServers["switchboard"] = buildCoordinatorServer(opts.onSpawnWorker);
  }
  const options: Options = {
    cwd: opts.worktreePath,
    model: opts.model,
    effort: opts.effort,
    permissionMode: "default",
    canUseTool,
    systemPrompt: WORKER_SYSTEM_PROMPT,
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
    ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
  };

  const q = query({ prompt: queue, options });

  registerAgentSession(sid, {
    query: q,
    pushMessage: (text: string) => queue.push(text),
    dir: opts.dir,
    worktreePath: opts.worktreePath,
    branch: opts.branch,
    sessionAllowAll: false,
  });

  queue.push(task);

  try {
    for await (const message of q) {
      handleMessage(sid, message);
    }
  } catch (err) {
    pushFeedEvent({ sid, kind: "error", own: false, verb: `session stream error: ${String(err)}` });
  }
}

// Text from the most recent assistant message only (reset on every new
// assistant message, not accumulated across the whole turn) — the system
// prompt instructs the agent to make its final reply a concise summary, so
// capturing just that last message is what makes the posted summary
// actually concise instead of a dump of every intermediate narration line.
const turnText = new Map<string, string[]>();

function beginAssistantMessage(sid: string): void {
  turnText.set(sid, []);
}

function collectTurnText(sid: string, text: string): void {
  const existing = turnText.get(sid);
  if (existing) existing.push(text);
  else turnText.set(sid, [text]);
}

const TURN_SUMMARY_LIMIT = 500;

// Posts the summary both to the feed (visible at a glance across all
// sessions) and into this session's own transcript (so it scrolls by inline
// with the rest of the live updates when you have the session open).
function flushTurnSummary(sid: string): void {
  const blocks = turnText.get(sid);
  turnText.delete(sid);
  if (!blocks || blocks.length === 0) return;

  const text = blocks.join("\n\n").trim();
  if (!text) return;

  const body = text.length > TURN_SUMMARY_LIMIT ? `${text.slice(0, TURN_SUMMARY_LIMIT)}…` : text;
  pushTranscriptMessage(sid, { k: "summary", text: body });
  pushFeedEvent({ sid, kind: "message", own: false, verb: "responded", body });
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text?: string } => typeof block === "object" && block !== null)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

// The full SDKMessage union has 20+ variants (retry/hook/task-progress/etc.)
// beyond the ones handled here — verify against the installed package's
// sdk.d.ts and extend incrementally rather than guessing subtype names.
function handleMessage(sid: string, message: SDKMessage): void {
  const anyMessage = message as unknown as Record<string, unknown>;

  switch (anyMessage.type) {
    case "system": {
      if (anyMessage.subtype === "init") {
        pushSessionPatch(sid, { status: "running", statusLine: "Working…", phase: "executing" });
      } else if (anyMessage.subtype === "session_state_changed") {
        const state = anyMessage.state as string;
        if (state === "running") {
          pushSessionPatch(sid, { status: "running", statusLine: "Working…", phase: "executing" });
        } else if (state === "idle") {
          pushSessionPatch(sid, {
            status: "running",
            statusLine: "Idle — ready for the next message",
            phase: "reviewing",
          });
        }
        // "requires_action" is handled directly inside canUseTool itself.
      }
      break;
    }

    case "assistant": {
      const content = (anyMessage.message as { content?: unknown } | undefined)?.content;
      if (Array.isArray(content)) {
        beginAssistantMessage(sid);
        for (const block of content as { type: string; text?: string; name?: string; input?: unknown }[]) {
          if (block.type === "text" && block.text) {
            pushTranscriptMessage(sid, { k: "text", text: block.text });
            collectTurnText(sid, block.text);
          } else if (block.type === "tool_use") {
            const label = block.input && typeof block.input === "object"
              ? JSON.stringify(block.input)
              : String(block.input ?? "");
            pushTranscriptMessage(sid, { k: "tool", text: `▸ ${block.name ?? "tool"}: ${label}` });
          }
        }
      }
      break;
    }

    case "user": {
      if (anyMessage.isSynthetic) {
        const content = (anyMessage.message as { content?: unknown } | undefined)?.content;
        const text = textFromContent(content);
        if (text) pushTranscriptMessage(sid, { k: "tool", text: text.slice(0, 800) });
      }
      break;
    }

    case "result": {
      const cost = anyMessage.total_cost_usd;
      if (typeof cost === "number") pushSessionPatch(sid, { cost });
      // A "result" marks the end of one turn, not the end of the session —
      // more messages (approvals, chat replies, retries) can still arrive
      // via the same queue, so this deliberately does not set status "done".
      if (anyMessage.subtype === "success") {
        flushTurnSummary(sid);
      } else if (anyMessage.subtype) {
        turnText.delete(sid);
        const errors = Array.isArray(anyMessage.errors) ? (anyMessage.errors as string[]) : [];
        pushFeedEvent({
          sid,
          kind: "error",
          own: false,
          verb: errors.length ? errors.join("; ") : `turn ended with an error (${anyMessage.subtype})`,
        });
      }
      break;
    }

    default:
      break;
  }
}

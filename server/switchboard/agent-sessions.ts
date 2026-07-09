import { query } from "npm:@anthropic-ai/claude-agent-sdk@^0.3.204";
import type {
  CanUseTool,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "npm:@anthropic-ai/claude-agent-sdk@^0.3.204";
import type { Effort, Model } from "../../src/switchboard/types.ts";
import { pushFeedEvent, pushSessionPatch, pushTranscriptMessage } from "./mutations.ts";
import { getAgentSession, registerAgentSession, registerPendingApproval } from "./agent-registry.ts";

const WORKER_SYSTEM_PROMPT =
  "You are an autonomous worker agent running inside Switchboard, a multi-agent orchestration UI. " +
  "Work through the task you were given, narrate meaningful progress in plain language, and use your " +
  "tools to do real work in the git worktree you've been given as your working directory.";

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

  const options: Options = {
    cwd: opts.worktreePath,
    model: opts.model,
    effort: opts.effort,
    permissionMode: "default",
    canUseTool,
    systemPrompt: WORKER_SYSTEM_PROMPT,
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
        for (const block of content as { type: string; text?: string; name?: string; input?: unknown }[]) {
          if (block.type === "text" && block.text) {
            pushTranscriptMessage(sid, { k: "text", text: block.text });
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
      if (anyMessage.subtype && anyMessage.subtype !== "success") {
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

// The coding toolset for ADK-driven (Gemini) sessions. Unlike the Claude
// SDK — which brings its own tools and routes them through a canUseTool
// callback — ADK ships no coding tools at all, so these are ours. That
// inverts where permission gating lives: each mutating tool's execute()
// calls gateToolCall() itself, reproducing the exact approval flow
// agent-sessions.ts's canUseTool runs (same feed event shape, same
// registry, same resolutions.ts approve/deny path on the other side).

import { FunctionTool } from "npm:@google/adk@^1.3.0";
import { z } from "npm:zod@^4.4.3";
import { join, normalize, resolve } from "jsr:@std/path";
import { pushFeedEvent, pushSessionPatch, pushTranscriptMessage } from "./mutations.ts";
import { type ApprovalDecision, getAgentSession, registerPendingApproval, resolvePendingApproval } from "./agent-registry.ts";
import type { SpawnWorkerResult } from "./agent-sessions.ts";

// Everything a tool needs from its session, handed in by the driver at
// spawn time. `currentSignal` returns the in-flight turn's abort signal —
// it changes every turn, hence a getter rather than a value.
export interface AdkToolContext {
  sid: string;
  worktreePath: string;
  currentSignal: () => AbortSignal | undefined;
  onSpawnWorker?: (task: string, name?: string) => Promise<SpawnWorkerResult>;
}

// --- Approval gating -------------------------------------------------------

// Gates outstanding per session, so a stop/interrupt can settle them —
// without this, closing a session mid-approval would leave the gated tool's
// execute() promise (and the whole ADK turn) hanging forever. The Claude
// driver gets the same guarantee from the SDK's per-call AbortSignal.
const pendingGates = new Map<string, Set<string>>();

export function settlePendingGates(sid: string, message: string): void {
  const gates = pendingGates.get(sid);
  if (!gates) return;
  pendingGates.delete(sid);
  for (const eventId of gates) {
    resolvePendingApproval(eventId, { allow: false, message });
  }
}

export function gateToolCall(sid: string, toolName: string, command: string, why: string): Promise<ApprovalDecision> {
  const handle = getAgentSession(sid);
  if (handle?.sessionAllowAll) {
    return Promise.resolve({ allow: true });
  }

  const feedEvent = pushFeedEvent({
    sid,
    kind: "approval",
    own: false,
    verb: `wants to use ${toolName}`,
    command,
    grantPattern: `${toolName} *`,
    why,
  });
  pushTranscriptMessage(sid, { k: "perm", eventId: feedEvent.id });
  pushSessionPatch(sid, { status: "waiting", statusLine: "Waiting for your input", phase: "gated" });

  return new Promise<ApprovalDecision>((resolve) => {
    registerPendingApproval(feedEvent.id, (decision) => {
      pendingGates.get(sid)?.delete(feedEvent.id);
      resolve(decision);
    });
    let gates = pendingGates.get(sid);
    if (!gates) pendingGates.set(sid, gates = new Set());
    gates.add(feedEvent.id);
  });
}

// --- Path jail -------------------------------------------------------------

// Confines file tools to the session's worktree. Prefix check on the
// normalized resolved path — symlinks inside the tree pointing out are not
// chased (same trust level as the gated bash tool, which can touch anything
// anyway; the jail is about keeping the model honest, not sandboxing).
function jail(worktreePath: string, path: string): string | { error: string } {
  const resolved = normalize(resolve(worktreePath, path));
  const root = normalize(resolve(worktreePath));
  if (resolved !== root && !resolved.startsWith(root.endsWith("/") ? root : `${root}/`)) {
    return { error: `Path escapes the session's working directory: ${path}` };
  }
  return resolved;
}

// --- Tools -----------------------------------------------------------------

const MAX_GREP_MATCHES = 200;
const MAX_BASH_OUTPUT = 30_000;
const MAX_READ_BYTES = 256 * 1024;

export function buildCodingTools(ctx: AdkToolContext): FunctionTool<z.ZodObject<z.ZodRawShape>>[] {
  const { sid, worktreePath } = ctx;

  const readFile = new FunctionTool({
    name: "read_file",
    description: "Read a text file from the working directory. Returns the content, optionally a line range.",
    parameters: z.object({
      path: z.string().describe("File path, relative to the working directory."),
      offset: z.number().optional().describe("1-based line number to start from."),
      limit: z.number().optional().describe("Maximum number of lines to return."),
    }),
    execute: async ({ path, offset, limit }) => {
      const target = jail(worktreePath, path);
      if (typeof target !== "string") return target;
      try {
        const info = await Deno.stat(target);
        if (info.size > MAX_READ_BYTES && !limit) {
          return { error: `File is ${info.size} bytes — pass offset/limit to read part of it.` };
        }
        const text = await Deno.readTextFile(target);
        if (!offset && !limit) return { content: text };
        const lines = text.split("\n");
        const start = Math.max(0, (offset ?? 1) - 1);
        return { content: lines.slice(start, limit ? start + limit : undefined).join("\n") };
      } catch (err) {
        return { error: String(err) };
      }
    },
  });

  const listDir = new FunctionTool({
    name: "list_dir",
    description: "List the entries of a directory in the working directory.",
    parameters: z.object({
      path: z.string().optional().describe("Directory path relative to the working directory. Defaults to the root."),
    }),
    execute: async ({ path }) => {
      const target = jail(worktreePath, path ?? ".");
      if (typeof target !== "string") return target;
      try {
        const entries: string[] = [];
        for await (const entry of Deno.readDir(target)) {
          entries.push(entry.isDirectory ? `${entry.name}/` : entry.name);
        }
        return { entries: entries.sort() };
      } catch (err) {
        return { error: String(err) };
      }
    },
  });

  const grep = new FunctionTool({
    name: "grep",
    description: "Search file contents in the working directory with a regular expression. Returns matching lines as 'path:line: text'.",
    parameters: z.object({
      pattern: z.string().describe("JavaScript regular expression to search for."),
      path: z.string().optional().describe("Subdirectory to search in. Defaults to the whole working directory."),
      glob: z.string().optional().describe("Only search files whose name ends with this suffix (e.g. '.ts')."),
    }),
    execute: async ({ pattern, path, glob }) => {
      const target = jail(worktreePath, path ?? ".");
      if (typeof target !== "string") return target;
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (err) {
        return { error: `Bad pattern: ${String(err)}` };
      }
      const matches: string[] = [];
      const walk = async (dir: string, rel: string): Promise<void> => {
        if (matches.length >= MAX_GREP_MATCHES) return;
        for await (const entry of Deno.readDir(dir)) {
          if (matches.length >= MAX_GREP_MATCHES) return;
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          const abs = join(dir, entry.name);
          const relPath = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory) {
            await walk(abs, relPath);
          } else if (!glob || entry.name.endsWith(glob)) {
            try {
              const lines = (await Deno.readTextFile(abs)).split("\n");
              for (let i = 0; i < lines.length && matches.length < MAX_GREP_MATCHES; i++) {
                if (regex.test(lines[i])) matches.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
              }
            } catch {
              // binary or unreadable — skip
            }
          }
        }
      };
      try {
        await walk(target, path && path !== "." ? path : "");
      } catch (err) {
        return { error: String(err) };
      }
      return { matches, truncated: matches.length >= MAX_GREP_MATCHES };
    },
  });

  const writeFile = new FunctionTool({
    name: "write_file",
    description: "Create or overwrite a file in the working directory. Requires user approval.",
    parameters: z.object({
      path: z.string().describe("File path, relative to the working directory."),
      content: z.string().describe("The full new content of the file."),
    }),
    execute: async ({ path, content }) => {
      const target = jail(worktreePath, path);
      if (typeof target !== "string") return target;
      const decision = await gateToolCall(sid, "write_file", `write ${path} (${content.length} chars)`, "The agent wants to write a file.");
      if (!decision.allow) return { error: decision.message };
      try {
        await Deno.mkdir(resolve(target, ".."), { recursive: true });
        await Deno.writeTextFile(target, content);
        return { ok: true };
      } catch (err) {
        return { error: String(err) };
      }
    },
  });

  const editFile = new FunctionTool({
    name: "edit_file",
    description: "Replace an exact string in a file. old_string must match exactly and (unless replace_all) uniquely. Requires user approval.",
    parameters: z.object({
      path: z.string().describe("File path, relative to the working directory."),
      old_string: z.string().describe("The exact text to replace."),
      new_string: z.string().describe("The replacement text."),
      replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring uniqueness."),
    }),
    execute: async ({ path, old_string, new_string, replace_all }) => {
      const target = jail(worktreePath, path);
      if (typeof target !== "string") return target;
      const decision = await gateToolCall(sid, "edit_file", `edit ${path}`, "The agent wants to edit a file.");
      if (!decision.allow) return { error: decision.message };
      try {
        const text = await Deno.readTextFile(target);
        const first = text.indexOf(old_string);
        if (first === -1) return { error: "old_string not found in the file." };
        if (!replace_all && text.indexOf(old_string, first + 1) !== -1) {
          return { error: "old_string is not unique in the file — add surrounding context or set replace_all." };
        }
        const next = replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, new_string);
        await Deno.writeTextFile(target, next);
        return { ok: true };
      } catch (err) {
        return { error: String(err) };
      }
    },
  });

  const bash = new FunctionTool({
    name: "bash",
    description: "Run a shell command in the working directory. Requires user approval. Output is capped.",
    parameters: z.object({
      command: z.string().describe("The shell command to run (via sh -c)."),
      timeout_ms: z.number().optional().describe("Kill the command after this many milliseconds (default 120000)."),
    }),
    execute: async ({ command, timeout_ms }) => {
      const decision = await gateToolCall(sid, "bash", command, "The agent wants to run a shell command.");
      if (!decision.allow) return { error: decision.message };
      // Tie the child to both the turn's abort signal (interrupt/stop kills
      // it) and the timeout.
      const timeoutSignal = AbortSignal.timeout(timeout_ms ?? 120_000);
      const turnSignal = ctx.currentSignal();
      const signal = turnSignal ? AbortSignal.any([turnSignal, timeoutSignal]) : timeoutSignal;
      try {
        const { code, stdout, stderr } = await new Deno.Command("sh", {
          args: ["-c", command],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
          signal,
        }).output();
        const decoder = new TextDecoder();
        const output = (decoder.decode(stdout) + decoder.decode(stderr)).slice(0, MAX_BASH_OUTPUT);
        return { exit_code: code, output };
      } catch (err) {
        return { error: signal.aborted ? "Command aborted." : String(err) };
      }
    },
  });

  const tools = [readFile, listDir, grep, writeFile, editFile, bash];

  if (ctx.onSpawnWorker) {
    const onSpawnWorker = ctx.onSpawnWorker;
    tools.push(
      new FunctionTool({
        name: "spawn_worker",
        description: "Spawn a new worker agent session as part of this team. The worker gets its own git worktree " +
          "branched from your current branch, so commit anything it needs to see before calling this. Requires user approval.",
        parameters: z.object({
          task: z.string().describe("A clear, self-contained description of what this worker should do."),
          name: z.string().optional().describe("A short display name for this worker — how the human sees it in the UI."),
        }),
        execute: async ({ task, name }) => {
          const decision = await gateToolCall(sid, "spawn_worker", `spawn worker: ${task.slice(0, 120)}`, "The agent wants to spawn a teammate.");
          if (!decision.allow) return { error: decision.message };
          const result = await onSpawnWorker(task, name);
          return result.ok ? { ok: true, message: `Worker spawned for: ${task}` } : { error: `Failed to spawn worker: ${result.error}` };
        },
      }),
    );
  }

  return tools;
}

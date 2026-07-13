// Claude Code hook shim for board workers (plan section 7, "Hooks:
// enforcement, not hope"). One script, one subcommand per hook event —
// wired up in .claude/settings.json:
//
//   session-start   SessionStart      register (idempotent) + inject identity/team status
//   prompt-submit   UserPromptSubmit  heartbeat + nudge if unread messages/events piled up
//   post-tool-use   PostToolUse       heartbeat on Edit/Write + fileScope drift warning
//   session-end     SessionEnd        release held card, mark agent offline
//
// Hooks make the lifecycle correct even when the model forgets the
// protocol; CLAUDE.md makes the model cooperative in between.
//
// Gate: does nothing unless AGENT_BOARD (board slug) is set in the
// session's environment — ordinary dev sessions in this repo pay zero
// cost. spawn-worker.sh sets it for headless workers; set it manually to
// make an interactive session a worker.
//
// Every network call is best-effort with a short timeout: a hook must
// never hang or fail the session just because the board daemon is down.
//
// Structured as exported functions over an injected HookConfig (base URL,
// state dir, …) with the CLI entry under import.meta.main, so tests can
// drive the handlers against an in-process server (see board-hook.test.ts).

import { globToRegExp } from "jsr:@std/path@^1/glob-to-regexp";
import { relative } from "jsr:@std/path@^1/relative";

export interface HookConfig {
  board: string;
  base: string; // e.g. http://localhost:8000/api/orchestration
  token?: string;
  stateDir: string; // where per-session agent-identity files live
  agentName?: string;
  agentRole?: string;
  timeoutMs?: number;
}

// null = the gate is closed (not a board worker session).
export function configFromEnv(): HookConfig | null {
  const board = Deno.env.get("AGENT_BOARD");
  if (!board) return null;
  return {
    board,
    base: Deno.env.get("BOARD_URL") ?? "http://localhost:8000/api/orchestration",
    token: Deno.env.get("ORCHESTRATION_TOKEN") ?? undefined,
    stateDir: Deno.env.get("TMPDIR") ?? Deno.env.get("TEMP") ?? Deno.env.get("TMP") ?? "/tmp",
    agentName: Deno.env.get("BOARD_AGENT_NAME") ?? undefined,
    agentRole: Deno.env.get("BOARD_AGENT_ROLE") ?? undefined,
  };
}

export interface HookPayload {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

async function api(cfg: HookConfig, method: string, path: string, body?: unknown): Promise<unknown | null> {
  try {
    const res = await fetch(`${cfg.base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 3000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

// Agent identity persists across hook invocations (each is a fresh
// process) in a file keyed by Claude Code session id.
function stateFile(cfg: HookConfig, sessionId: string): string {
  return `${cfg.stateDir}/board-agent-${sessionId}.json`;
}

interface AgentState {
  agentId: string;
  name: string;
}

function loadState(cfg: HookConfig, sessionId: string): AgentState | null {
  try {
    return JSON.parse(Deno.readTextFileSync(stateFile(cfg, sessionId)));
  } catch {
    return null;
  }
}

// Hook JSON output: additionalContext is injected into the model's context.
function contextResult(hookEventName: string, text: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } });
}

interface HeartbeatResponse {
  agent?: { id: string; currentCardId?: string };
  unreadMessages?: number;
  newEvents?: number;
}

async function sessionStart(cfg: HookConfig, payload: HookPayload): Promise<string | null> {
  const sid = payload.session_id ?? "unknown";
  const name = cfg.agentName ?? `worker-${sid.slice(0, 6)}`;
  const role = cfg.agentRole ?? "worker";
  const agent = await api(cfg, "POST", `/boards/${cfg.board}/agents`, { name, role }) as { id?: string } | null;
  if (!agent?.id) {
    return contextResult(
      "SessionStart",
      `Board daemon at ${cfg.base} is unreachable or rejected registration — worker protocol is inactive. Say so and stop rather than working uncoordinated.`,
    );
  }
  Deno.writeTextFileSync(stateFile(cfg, sid), JSON.stringify({ agentId: agent.id, name } satisfies AgentState));
  const team = await api(cfg, "GET", `/boards/${cfg.board}/agents`) as
    | Array<{ name: string; role: string; status: string; currentCardId?: string }>
    | null;
  const teamLine = team
    ? team.map((a) => `${a.name}(${a.role}): ${a.status}${a.currentCardId ? ` on ${a.currentCardId.slice(-6).toLowerCase()}` : ""}`).join("; ")
    : "unavailable";
  return contextResult(
    "SessionStart",
    `You are registered on board '${cfg.board}' as ${name} (agent_id: ${agent.id}). Follow the "Board worker protocol" section of CLAUDE.md. Team: ${teamLine}`,
  );
}

async function promptSubmit(cfg: HookConfig, payload: HookPayload): Promise<string | null> {
  const state = loadState(cfg, payload.session_id ?? "unknown");
  if (!state) return null;
  const hb = await api(cfg, "POST", `/boards/${cfg.board}/agents/${state.agentId}/heartbeat`, {}) as HeartbeatResponse | null;
  if (!hb) return null;
  if ((hb.unreadMessages ?? 0) > 0 || (hb.newEvents ?? 0) > 0) {
    return contextResult(
      "UserPromptSubmit",
      `Board '${cfg.board}': ${hb.unreadMessages ?? 0} unread message(s), ${hb.newEvents ?? 0} new event(s). Call check_messages / watch_events at your next checkpoint.`,
    );
  }
  return null;
}

// Paths Edit/Write/NotebookEdit put the target file under, depending on tool.
function editedPath(input: Record<string, unknown> | undefined): string | null {
  const p = input?.file_path ?? input?.notebook_path;
  return typeof p === "string" ? p : null;
}

async function postToolUse(cfg: HookConfig, payload: HookPayload): Promise<string | null> {
  const state = loadState(cfg, payload.session_id ?? "unknown");
  if (!state) return null;
  const hb = await api(cfg, "POST", `/boards/${cfg.board}/agents/${state.agentId}/heartbeat`, {}) as HeartbeatResponse | null;
  const cardId = hb?.agent?.currentCardId;
  const filePath = editedPath(payload.tool_input);
  if (!cardId || !filePath) return null;
  const card = await api(cfg, "GET", `/boards/${cfg.board}/cards/${cardId}`) as { fileScope?: string[] } | null;
  const scope = card?.fileScope ?? [];
  if (scope.length === 0) return null;
  // fileScope globs are repo-relative; the worker may be editing inside a
  // ../wt/card-* worktree, so relativize against the hook's cwd.
  const rel = payload.cwd ? relative(payload.cwd, filePath) : filePath;
  const inScope = scope.some((glob) => globToRegExp(glob, { extended: true, globstar: true }).test(rel));
  if (!inScope) {
    return contextResult(
      "PostToolUse",
      `Warning: ${rel} is outside your card's fileScope (${scope.join(", ")}). Undo it, or message the affected card's holder before continuing (worker protocol step 3).`,
    );
  }
  return null;
}

async function sessionEnd(cfg: HookConfig, payload: HookPayload): Promise<string | null> {
  const sid = payload.session_id ?? "unknown";
  const state = loadState(cfg, sid);
  if (!state) return null;
  // Release before going offline: releaseCard resets the agent to "idle",
  // so the offline heartbeat must come last.
  const hb = await api(cfg, "POST", `/boards/${cfg.board}/agents/${state.agentId}/heartbeat`, {}) as HeartbeatResponse | null;
  const cardId = hb?.agent?.currentCardId;
  if (cardId) {
    await api(cfg, "POST", `/boards/${cfg.board}/cards/${cardId}/release`, { agentId: state.agentId, reason: "session ended" });
  }
  await api(cfg, "POST", `/boards/${cfg.board}/agents/${state.agentId}/heartbeat`, { status: "offline" });
  try {
    Deno.removeSync(stateFile(cfg, sid));
  } catch {
    // already gone — fine
  }
  return null;
}

export async function runHook(subcommand: string, payload: HookPayload, cfg: HookConfig): Promise<string | null> {
  switch (subcommand) {
    case "session-start":
      return await sessionStart(cfg, payload);
    case "prompt-submit":
      return await promptSubmit(cfg, payload);
    case "post-tool-use":
      return await postToolUse(cfg, payload);
    case "session-end":
      return await sessionEnd(cfg, payload);
    default:
      throw new Error(`board-hook: unknown subcommand ${subcommand}`);
  }
}

async function readPayload(): Promise<HookPayload> {
  try {
    const raw = await new Response(Deno.stdin.readable).text();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

if (import.meta.main) {
  const cfg = configFromEnv();
  if (!cfg) Deno.exit(0);
  const payload = await readPayload();
  try {
    const output = await runHook(Deno.args[0], payload, cfg);
    if (output !== null) console.log(output);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    Deno.exit(1);
  }
}

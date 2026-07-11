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

import { globToRegExp } from "jsr:@std/path@^1/glob-to-regexp";
import { relative } from "jsr:@std/path@^1/relative";

const BOARD = Deno.env.get("AGENT_BOARD");
if (!BOARD) Deno.exit(0);

const BASE = Deno.env.get("BOARD_URL") ?? "http://localhost:8000/api/orchestration";
const TOKEN = Deno.env.get("ORCHESTRATION_TOKEN");

interface HookPayload {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

async function readPayload(): Promise<HookPayload> {
  try {
    const raw = await new Response(Deno.stdin.readable).text();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function api(method: string, path: string, body?: unknown): Promise<unknown | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
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
// process) in a tmp file keyed by Claude Code session id.
function stateFile(sessionId: string): string {
  return `${Deno.env.get("TMPDIR") ?? "/tmp"}/board-agent-${sessionId}.json`;
}

interface AgentState {
  agentId: string;
  name: string;
}

function loadState(sessionId: string): AgentState | null {
  try {
    return JSON.parse(Deno.readTextFileSync(stateFile(sessionId)));
  } catch {
    return null;
  }
}

// Hook JSON output: additionalContext is injected into the model's context.
function emitContext(hookEventName: string, text: string): void {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } }));
}

interface HeartbeatResponse {
  agent?: { id: string; currentCardId?: string };
  unreadMessages?: number;
  newEvents?: number;
}

async function sessionStart(payload: HookPayload): Promise<void> {
  const sid = payload.session_id ?? "unknown";
  const name = Deno.env.get("BOARD_AGENT_NAME") ?? `worker-${sid.slice(0, 6)}`;
  const role = Deno.env.get("BOARD_AGENT_ROLE") ?? "worker";
  const agent = await api("POST", `/boards/${BOARD}/agents`, { name, role }) as { id?: string } | null;
  if (!agent?.id) {
    emitContext("SessionStart", `Board daemon at ${BASE} is unreachable or rejected registration — worker protocol is inactive. Say so and stop rather than working uncoordinated.`);
    return;
  }
  Deno.writeTextFileSync(stateFile(sid), JSON.stringify({ agentId: agent.id, name } satisfies AgentState));
  const team = await api("GET", `/boards/${BOARD}/agents`) as Array<{ name: string; role: string; status: string; currentCardId?: string }> | null;
  const teamLine = team
    ? team.map((a) => `${a.name}(${a.role}): ${a.status}${a.currentCardId ? ` on ${a.currentCardId.slice(-6).toLowerCase()}` : ""}`).join("; ")
    : "unavailable";
  emitContext(
    "SessionStart",
    `You are registered on board '${BOARD}' as ${name} (agent_id: ${agent.id}). Follow the "Board worker protocol" section of CLAUDE.md. Team: ${teamLine}`,
  );
}

async function promptSubmit(payload: HookPayload): Promise<void> {
  const state = loadState(payload.session_id ?? "unknown");
  if (!state) return;
  const hb = await api("POST", `/boards/${BOARD}/agents/${state.agentId}/heartbeat`, {}) as HeartbeatResponse | null;
  if (!hb) return;
  if ((hb.unreadMessages ?? 0) > 0 || (hb.newEvents ?? 0) > 0) {
    emitContext(
      "UserPromptSubmit",
      `Board '${BOARD}': ${hb.unreadMessages ?? 0} unread message(s), ${hb.newEvents ?? 0} new event(s). Call check_messages / watch_events at your next checkpoint.`,
    );
  }
}

// Paths Edit/Write/NotebookEdit put the target file under, depending on tool.
function editedPath(input: Record<string, unknown> | undefined): string | null {
  const p = input?.file_path ?? input?.notebook_path;
  return typeof p === "string" ? p : null;
}

async function postToolUse(payload: HookPayload): Promise<void> {
  const state = loadState(payload.session_id ?? "unknown");
  if (!state) return;
  const hb = await api("POST", `/boards/${BOARD}/agents/${state.agentId}/heartbeat`, {}) as HeartbeatResponse | null;
  const cardId = hb?.agent?.currentCardId;
  const filePath = editedPath(payload.tool_input);
  if (!cardId || !filePath) return;
  const card = await api("GET", `/boards/${BOARD}/cards/${cardId}`) as { fileScope?: string[] } | null;
  const scope = card?.fileScope ?? [];
  if (scope.length === 0) return;
  // fileScope globs are repo-relative; the worker may be editing inside a
  // ../wt/card-* worktree, so relativize against the hook's cwd.
  const rel = payload.cwd ? relative(payload.cwd, filePath) : filePath;
  const inScope = scope.some((glob) => globToRegExp(glob, { extended: true, globstar: true }).test(rel));
  if (!inScope) {
    emitContext(
      "PostToolUse",
      `Warning: ${rel} is outside your card's fileScope (${scope.join(", ")}). Undo it, or message the affected card's holder before continuing (worker protocol step 3).`,
    );
  }
}

async function sessionEnd(payload: HookPayload): Promise<void> {
  const sid = payload.session_id ?? "unknown";
  const state = loadState(sid);
  if (!state) return;
  // Release before going offline: releaseCard resets the agent to "idle",
  // so the offline heartbeat must come last.
  const hb = await api("POST", `/boards/${BOARD}/agents/${state.agentId}/heartbeat`, {}) as HeartbeatResponse | null;
  const cardId = hb?.agent?.currentCardId;
  if (cardId) {
    await api("POST", `/boards/${BOARD}/cards/${cardId}/release`, { agentId: state.agentId, reason: "session ended" });
  }
  await api("POST", `/boards/${BOARD}/agents/${state.agentId}/heartbeat`, { status: "offline" });
  try {
    Deno.removeSync(stateFile(sid));
  } catch {
    // already gone — fine
  }
}

const payload = await readPayload();
switch (Deno.args[0]) {
  case "session-start":
    await sessionStart(payload);
    break;
  case "prompt-submit":
    await promptSubmit(payload);
    break;
  case "post-tool-use":
    await postToolUse(payload);
    break;
  case "session-end":
    await sessionEnd(payload);
    break;
  default:
    console.error(`board-hook: unknown subcommand ${Deno.args[0]}`);
    Deno.exit(1);
}

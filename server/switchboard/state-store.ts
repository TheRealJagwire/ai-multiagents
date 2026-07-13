// Persists the rest of switchboard's in-memory state (sessions, teams,
// feed events, grants, transcripts, MCP configs) to disk so a crash or
// restart doesn't wipe the visible history — the same reasoning as
// schedule-store.ts, extended to everything the Snapshot serves. Schedules
// and the catch-up setting are deliberately NOT here: they already persist
// via schedule-store.ts/settings-store.ts, and duplicating them would
// create a second source of truth.
//
// What restore can and can't do: the `claude` CLI subprocesses die with
// the app, so restoreStateFromDisk() brings every previously-live session
// back as status "stopped" with its transcript, feed history, cost, and
// branch intact — the work products survive; the process does not.

import { dirname, join } from "jsr:@std/path";
import type { FeedEvent, Grant, McpConfig, Session, Team, TranscriptMessage } from "../../src/switchboard/types.ts";
import { appDataDir } from "./app-data-dir.ts";
import { idCounter, setIdCounter, state } from "./state.ts";

export const STATE_FILE = join(appDataDir(), "state.json");

// Bounds keep state.json sane for a long-lived app: the feed keeps its
// newest entries (state.events is newest-first), each transcript its tail.
const MAX_PERSISTED_EVENTS = 1000;
const MAX_PERSISTED_TRANSCRIPT = 500;
const PERSIST_DEBOUNCE_MS = 400;

interface PersistedState {
  counter: number;
  sessions: Session[];
  teams: Team[];
  events: FeedEvent[];
  grants: Grant[];
  transcripts: Record<string, TranscriptMessage[]>;
  mcpConfigs: McpConfig[];
}

function snapshotForDisk(): PersistedState {
  const transcripts: Record<string, TranscriptMessage[]> = {};
  for (const [sid, messages] of Object.entries(state.transcripts)) {
    transcripts[sid] = messages.slice(-MAX_PERSISTED_TRANSCRIPT);
  }
  return {
    counter: idCounter(),
    sessions: state.sessions,
    teams: state.teams,
    events: state.events.slice(0, MAX_PERSISTED_EVENTS),
    grants: state.grants,
    transcripts,
    mcpConfigs: state.mcpConfigs,
  };
}

async function writeNow(persisted: PersistedState): Promise<void> {
  await Deno.mkdir(dirname(STATE_FILE), { recursive: true });
  // Write-to-temp-then-rename, same as schedule-store.ts: the file on disk
  // is always either the old complete contents or the new complete
  // contents, never a torn write — which is the whole point of a
  // crash-recovery file.
  const tmpFile = `${STATE_FILE}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmpFile, JSON.stringify(persisted));
  // Transcripts routinely contain secrets that tools echoed (env vars,
  // file contents) — same owner-only treatment settings.json gets.
  try {
    await Deno.chmod(tmpFile, 0o600);
  } catch {
    // no POSIX modes on this platform
  }
  await Deno.rename(tmpFile, STATE_FILE);
}

let writeChain: Promise<void> = Promise.resolve();
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// Every mutation in mutations.ts calls this. Mutations arrive in bursts (a
// single agent message can patch a session, append a transcript line, and
// push a feed event), so writes are debounced; the trailing write then
// serializes fresh state, so nothing in the burst is lost. Writes chain so
// two timers' flushes can never interleave on disk.
export function persistStateSoon(): void {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    const persisted = snapshotForDisk();
    writeChain = writeChain
      .then(() => writeNow(persisted))
      .catch((err) => {
        // Best-effort: a failed write leaves disk stale, never blocks the
        // in-memory mutation that triggered it.
        console.error(`[state] failed to save ${STATE_FILE}:`, err);
      });
  }, PERSIST_DEBOUNCE_MS);
}

// A session that was alive when the app died can't be reconnected (its
// process is gone) — surface that honestly instead of showing a stale
// "running". "idle" belongs here too: idle means a LIVE process waiting
// for input, which is exactly what a restart kills.
const DEAD_STATUSES = new Set(["running", "idle", "waiting", "paused"]);

function sanitizeRestoredSession(session: Session): Session {
  if (!DEAD_STATUSES.has(session.status)) return session;
  return {
    ...session,
    status: "stopped",
    phase: "stopped",
    statusLine: "App restarted — process not resumed; history restored",
    pendingModel: null,
    pendingEffort: null,
    pendingMove: null,
  };
}

// Loads state.json into `state` in place, before routes.ts starts serving
// (top-level await, same pattern as initSchedules) so the first
// GET /snapshot already contains the restored world. Malformed or missing
// fields degrade to empty rather than failing startup — a corrupt recovery
// file should never brick the app it exists to protect.
export async function initPersistedState(): Promise<void> {
  let parsed: Partial<PersistedState>;
  try {
    parsed = JSON.parse(await Deno.readTextFile(STATE_FILE));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      console.error(`[state] failed to load ${STATE_FILE}:`, err);
    }
    return;
  }
  if (parsed === null || typeof parsed !== "object") return;

  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);

  const restoredSessions = arr<Session>(parsed.sessions);
  state.sessions = restoredSessions.map(sanitizeRestoredSession);
  state.teams = arr<Team>(parsed.teams);
  state.events = arr<FeedEvent>(parsed.events);
  state.grants = arr<Grant>(parsed.grants);
  state.mcpConfigs = arr<McpConfig>(parsed.mcpConfigs);
  if (parsed.transcripts !== null && typeof parsed.transcripts === "object") {
    state.transcripts = {};
    for (const [sid, messages] of Object.entries(parsed.transcripts)) {
      state.transcripts[sid] = arr<TranscriptMessage>(messages);
    }
  }

  // Restore the id counter past everything on disk so new ids can never
  // collide with restored ones ("e-42" already taken, nextId hands out
  // "e-42" again). The stored counter is authoritative; scanning restored
  // ids is the belt-and-suspenders for files written by older versions.
  let maxSeen = typeof parsed.counter === "number" ? parsed.counter : 0;
  const scan = (id: string) => {
    const n = Number(id.slice(id.lastIndexOf("-") + 1));
    if (Number.isFinite(n) && n > maxSeen) maxSeen = n;
  };
  state.sessions.forEach((s) => scan(s.id));
  state.teams.forEach((t) => scan(t.id));
  state.events.forEach((e) => scan(e.id));
  state.grants.forEach((g) => scan(g.id));
  state.mcpConfigs.forEach((m) => scan(m.id));
  if (maxSeen > idCounter()) setIdCounter(maxSeen);

  // Leave a visible trace in each interrupted session's transcript so the
  // gap in history is explained where the user will actually look for it.
  // Only for sessions sanitized *this* launch — restoredSessions still holds
  // the pre-sanitize statuses, so a session already stopped on a previous
  // restart doesn't collect one note per launch.
  const RESTART_NOTE = "App restarted — the live process was lost; transcript above was restored from disk.";
  for (const restored of restoredSessions) {
    if (!DEAD_STATUSES.has(restored.status)) continue;
    state.transcripts[restored.id] = [
      ...(state.transcripts[restored.id] ?? []),
      { k: "note", text: RESTART_NOTE },
    ];
  }
}

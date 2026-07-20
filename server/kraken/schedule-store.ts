// Persists scheduled sessions/messages to disk so they survive an app
// restart — everything else in `state` (sessions, teams, transcripts) is
// intentionally still in-memory-only (each session is a live subprocess
// that can't be resumed across a restart anyway), but a *schedule* is just
// data describing something to do later, so there's no reason losing it
// should require the app to have stayed open the whole time.

import { dirname, join } from "jsr:@std/path";
import type { Schedule } from "../../src/kraken/types.ts";
import { appDataDir } from "./app-data-dir.ts";

export const SCHEDULES_FILE = join(appDataDir(), "schedules.json");

function isRecurrence(v: unknown): v is Schedule["recurrence"] {
  if (v === null) return true;
  if (typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (r.kind === "interval") {
    return (r.unit === "minutes" || r.unit === "hours" || r.unit === "days") && typeof r.every === "number";
  }
  if (r.kind === "weekly") {
    return Array.isArray(r.daysOfWeek) && r.daysOfWeek.every((d) => typeof d === "number") &&
      typeof r.hour === "number" && typeof r.minute === "number";
  }
  return false;
}

function isSchedulePayload(v: unknown): v is Schedule["payload"] {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.kind === "spawn") return typeof p.body === "object" && p.body !== null;
  if (p.kind === "message") {
    return typeof p.sessionId === "string" && typeof p.sessionLabel === "string" && typeof p.text === "string";
  }
  return false;
}

// Reconstructs one Schedule from an untrusted parsed-JSON value, or returns
// null to drop it — a single malformed/outdated entry (e.g. from a future
// app version) should never take the whole file down with it.
function reviveSchedule(v: unknown): Schedule | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.label !== "string") return null;
  if (typeof s.runAt !== "number" || typeof s.createdAt !== "number") return null;
  if (s.status !== "pending" && s.status !== "fired" && s.status !== "failed") return null;
  if (!isSchedulePayload(s.payload)) return null;
  if (!isRecurrence(s.recurrence ?? null)) return null;

  return {
    id: s.id,
    label: s.label,
    runAt: s.runAt,
    createdAt: s.createdAt,
    status: s.status,
    error: typeof s.error === "string" ? s.error : undefined,
    payload: s.payload,
    recurrence: (s.recurrence as Schedule["recurrence"]) ?? null,
    occurrenceCount: typeof s.occurrenceCount === "number" ? s.occurrenceCount : 0,
  };
}

export async function loadSchedulesFromDisk(): Promise<Schedule[]> {
  try {
    const text = await Deno.readTextFile(SCHEDULES_FILE);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(reviveSchedule).filter((s): s is Schedule => s !== null);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    console.error(`[schedules] failed to load ${SCHEDULES_FILE}:`, err);
    return [];
  }
}

async function writeNow(schedules: Schedule[]): Promise<void> {
  await Deno.mkdir(dirname(SCHEDULES_FILE), { recursive: true });
  // Write-to-temp-then-rename so a crash mid-write can never leave a
  // truncated/corrupt schedules.json — the rename is atomic, so the file at
  // SCHEDULES_FILE is always either the old complete contents or the new
  // complete contents, never a partial write.
  const tmpFile = `${SCHEDULES_FILE}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmpFile, JSON.stringify(schedules, null, 2));
  try {
    await Deno.chmod(tmpFile, 0o600);
  } catch {
    // no POSIX modes on this platform
  }
  await Deno.rename(tmpFile, SCHEDULES_FILE);
}

let writeChain: Promise<void> = Promise.resolve();

// Two schedule mutations in quick succession (e.g. a fire that immediately
// flips "fired" -> "failed") each call this — without serializing, their
// writes can interleave and corrupt the file, since neither await waits for
// the other. Chaining onto writeChain forces every write to wait for the
// previous one to finish, so they always land on disk in call order.
export function saveSchedulesToDisk(schedules: Schedule[]): Promise<void> {
  const task = writeChain.then(() => writeNow(schedules));
  writeChain = task.catch((err) => {
    // Best-effort — a failed write shouldn't crash the app or block the
    // in-memory mutation that triggered it, just leave disk stale. Swallowed
    // here (not rethrown) so the next queued write still proceeds.
    console.error(`[schedules] failed to save ${SCHEDULES_FILE}:`, err);
  });
  return task;
}

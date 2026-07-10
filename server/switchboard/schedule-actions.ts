import type { Recurrence, Schedule, SchedulePayload } from "../../src/switchboard/types.ts";
import { nextId, state } from "./state.ts";
import { pushFeedEvent, pushSchedulesReplace } from "./mutations.ts";
import { spawnFromBody } from "./spawn-actions.ts";
import { sendMessage } from "./session-actions.ts";

export function createSchedule(
  label: string,
  runAt: number,
  payload: SchedulePayload,
  recurrence: Recurrence | null = null,
): Schedule {
  const schedule: Schedule = {
    id: nextId("sc"),
    label,
    runAt,
    createdAt: Date.now(),
    status: "pending",
    payload,
    recurrence,
    occurrenceCount: 0,
  };
  pushSchedulesReplace([...state.schedules, schedule]);
  return schedule;
}

// Local-calendar arithmetic (not fixed ms addition) for day-granularity
// recurrence, so the wall-clock time-of-day survives DST transitions —
// "every day at 9am" should still say 9am after clocks change, not drift by
// an hour twice a year.
function computeNextRunAt(currentRunAt: number, recurrence: Recurrence): number {
  if (recurrence.kind === "interval") {
    if (recurrence.unit === "minutes") return currentRunAt + recurrence.every * 60_000;
    if (recurrence.unit === "hours") return currentRunAt + recurrence.every * 3_600_000;
    const next = new Date(currentRunAt);
    next.setDate(next.getDate() + recurrence.every);
    return next.getTime();
  }

  // "weekly": find the next matching local day-of-week at the anchor
  // hour:minute, always at least one day ahead of the occurrence that just fired.
  const from = new Date(currentRunAt);
  for (let addDays = 1; addDays <= 7; addDays++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + addDays);
    candidate.setHours(recurrence.hour, recurrence.minute, 0, 0);
    if (recurrence.daysOfWeek.includes(candidate.getDay())) return candidate.getTime();
  }
  // Unreachable in practice — daysOfWeek is validated non-empty at creation,
  // so the loop above always finds a match within 7 days.
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate() + 7);
  return fallback.getTime();
}

// Deleting is the only way to cancel a pending schedule — once it's gone
// from state, the poller's next tick simply never sees it. Also doubles as
// "clear" for a fired/failed entry the user is done looking at.
export function deleteSchedule(id: string): void {
  pushSchedulesReplace(state.schedules.filter((s) => s.id !== id));
}

function patchSchedule(id: string, patch: Partial<Schedule>): void {
  pushSchedulesReplace(state.schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

function fireSchedule(schedule: Schedule): void {
  // Marked fired before acting, so a schedule can never fire twice even if
  // the action below throws synchronously or a tick overlaps a slow one.
  // A recurring schedule flips back to "pending" with the next runAt right
  // after, so "fired" here is only ever visible mid-tick, not a real rest state.
  patchSchedule(schedule.id, { status: "fired" });
  try {
    if (schedule.payload.kind === "spawn") {
      spawnFromBody(schedule.payload.body);
    } else {
      const { sessionId, sessionLabel, text } = schedule.payload;
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session || session.status === "done" || session.status === "stopped") {
        throw new Error(`"${sessionLabel}" is no longer running`);
      }
      sendMessage(sessionId, text);
      pushFeedEvent({ sid: sessionId, kind: "info", own: true, verb: `scheduled message delivered: "${schedule.label}"` });
    }

    if (schedule.recurrence) {
      patchSchedule(schedule.id, {
        status: "pending",
        runAt: computeNextRunAt(schedule.runAt, schedule.recurrence),
        occurrenceCount: schedule.occurrenceCount + 1,
      });
    }
  } catch (err) {
    // A failure ends the series rather than silently retrying forever —
    // in practice this only happens for the (non-recurring) message kind,
    // since spawnFromBody handles its own errors internally instead of
    // throwing (see spawn-actions.ts), so a recurring spawn never lands here.
    patchSchedule(schedule.id, { status: "failed", error: String(err) });
  }
}

const TICK_MS = 15_000;
let tickTimer: ReturnType<typeof setInterval> | undefined;

// A poll loop instead of one setTimeout per schedule — setTimeout's delay is
// a 32-bit signed int under the hood, so anything scheduled more than ~24.8
// days out would silently fire immediately instead of waiting. Polling has
// no such ceiling and trivially survives schedules being added/canceled.
export function startScheduler(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    const now = Date.now();
    for (const schedule of state.schedules) {
      if (schedule.status === "pending" && schedule.runAt <= now) fireSchedule(schedule);
    }
  }, TICK_MS);
}

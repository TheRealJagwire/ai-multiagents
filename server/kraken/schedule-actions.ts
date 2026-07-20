import type { Recurrence, Schedule, SchedulePayload } from "../../src/kraken/types.ts";
import { nextId, state } from "./state.ts";
import { pushCatchUpMissedSchedulesReplace, pushFeedEvent, pushSchedulesReplace } from "./mutations.ts";
import { spawnFromBody } from "./spawn-actions.ts";
import { sendMessage } from "./session-actions.ts";
import { loadSchedulesFromDisk, saveSchedulesToDisk } from "./schedule-store.ts";
import { loadSettingsFromDisk, updateSettings } from "./settings-store.ts";

// Every mutation goes through here instead of pushSchedulesReplace directly,
// so "update in-memory state" and "persist it" can never drift apart. The
// save is fire-and-forget — schedule-store.ts logs its own failures instead
// of throwing, so a disk hiccup never breaks the in-memory mutation that
// triggered it.
function replaceSchedules(schedules: Schedule[]): void {
  pushSchedulesReplace(schedules);
  void saveSchedulesToDisk(schedules);
}

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
  replaceSchedules([...state.schedules, schedule]);
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

// Repeatedly advances past any occurrences that are already due, landing on
// the next one that's actually in the future. Used both when a recurring
// schedule fires normally (a tick can only ever be ~15s late) and when
// reconciling a long gap after the app was closed (could be days/weeks) —
// either way, we never want to land on a still-past time.
// Exported for tests (like service.ts's sweepBoard) — pure calendar logic
// that deserves direct coverage without driving the whole scheduler.
export function advancePastNow(runAt: number, recurrence: Recurrence, now: number): number {
  let next = computeNextRunAt(runAt, recurrence);
  while (next <= now) next = computeNextRunAt(next, recurrence);
  return next;
}

// Deleting is the only way to cancel a pending schedule — once it's gone
// from state, the poller's next tick simply never sees it. Also doubles as
// "clear" for a fired/failed entry the user is done looking at.
export function deleteSchedule(id: string): void {
  replaceSchedules(state.schedules.filter((s) => s.id !== id));
}

function patchSchedule(id: string, patch: Partial<Schedule>): void {
  replaceSchedules(state.schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)));
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
        runAt: advancePastNow(schedule.runAt, schedule.recurrence, Date.now()),
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

function tick(): void {
  const now = Date.now();
  for (const schedule of state.schedules) {
    if (schedule.status === "pending" && schedule.runAt <= now) fireSchedule(schedule);
  }
}

const TICK_MS = 15_000;
let tickTimer: ReturnType<typeof setInterval> | undefined;

// A poll loop instead of one setTimeout per schedule — setTimeout's delay is
// a 32-bit signed int under the hood, so anything scheduled more than ~24.8
// days out would silently fire immediately instead of waiting. Polling has
// no such ceiling and trivially survives schedules being added/canceled.
//
// The first tick runs immediately (not after the first TICK_MS wait) so
// that when catch-up IS enabled, anything that came due while the app
// wasn't running fires right away instead of waiting up to 15s. When
// catch-up is disabled, initSchedules() has already reconciled every missed
// schedule before this runs, so this first tick simply finds nothing due.
export function startScheduler(): void {
  if (tickTimer) return;
  tick();
  tickTimer = setInterval(tick, TICK_MS);
}

// Called once at startup for a schedule that was already due when the app
// launched, when the user has opted OUT of catch-up: a recurring schedule
// silently advances to its next future occurrence (no fire, no
// occurrenceCount bump — it didn't run); a one-shot schedule is marked
// "skipped" instead of being left "pending" (which would just fire on the
// very next tick regardless).
// Exported for tests.
export function reconcileMissedSchedule(schedule: Schedule, now: number): Schedule {
  if (schedule.status !== "pending" || schedule.runAt > now) return schedule;
  if (schedule.recurrence) {
    return { ...schedule, runAt: advancePastNow(schedule.runAt, schedule.recurrence, now) };
  }
  return { ...schedule, status: "skipped" };
}

export function setCatchUpMissedSchedules(value: boolean): void {
  pushCatchUpMissedSchedulesReplace(value);
  // Partial update, not a whole-object save — settings.json also holds
  // fields this module doesn't own (e.g. the in-app API key).
  void updateSettings({ catchUpMissedSchedules: value });
}

// Loads persisted schedules and the catch-up setting into state before the
// scheduler starts ticking (and before the server accepts requests — see
// routes.ts, which awaits this at module load) so GET /snapshot and the
// poller both see them from the very first moment, not "empty, then
// populated a beat later." When catch-up is off, this is also where missed
// schedules get reconciled — startScheduler()'s first tick runs right
// after, so anything left "pending" with a past runAt at that point would
// otherwise fire regardless of the setting.
export async function initSchedules(): Promise<void> {
  const [loaded, settings] = await Promise.all([loadSchedulesFromDisk(), loadSettingsFromDisk()]);
  pushCatchUpMissedSchedulesReplace(settings.catchUpMissedSchedules);

  if (settings.catchUpMissedSchedules) {
    if (loaded.length > 0) pushSchedulesReplace(loaded);
    return;
  }

  const now = Date.now();
  const reconciled = loaded.map((s) => reconcileMissedSchedule(s, now));
  if (reconciled.length > 0) replaceSchedules(reconciled);
}

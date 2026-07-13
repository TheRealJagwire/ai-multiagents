import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import type { Schedule } from "../../src/switchboard/types.ts";

// schedule-actions transitively imports the settings/schedule stores, whose
// file paths bind to appDataDir() at import time — isolate before loading.
Deno.env.set("SWITCHBOARD_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-sched-test-" }));
const { advancePastNow, reconcileMissedSchedule } = await import("./schedule-actions.ts");

const MIN = 60_000;
const HOUR = 3_600_000;

function makeSchedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: "sc-1",
    label: "test",
    runAt: 0,
    createdAt: 0,
    status: "pending",
    payload: { kind: "spawn", body: {} },
    recurrence: null,
    occurrenceCount: 0,
    ...overrides,
  };
}

describe("advancePastNow", () => {
  it("advances a minute interval to the first future occurrence, skipping missed ones", () => {
    const runAt = Date.parse("2026-01-01T09:00:00Z");
    const now = runAt + 10 * MIN + 1; // ten occurrences missed
    const next = advancePastNow(runAt, { kind: "interval", unit: "minutes", every: 1 }, now);
    assertEquals(next, runAt + 11 * MIN);
  });

  it("advances an hourly interval past a multi-day gap", () => {
    const runAt = Date.parse("2026-01-01T09:00:00Z");
    const now = runAt + 3 * 24 * HOUR + 1;
    const next = advancePastNow(runAt, { kind: "interval", unit: "hours", every: 6 }, now);
    assert(next > now);
    assertEquals((next - runAt) % (6 * HOUR), 0, "stays on the 6-hour grid");
  });

  it("daily recurrence keeps the local wall-clock time", () => {
    // Local-calendar arithmetic: +1 day lands at the same local hour even
    // if a DST transition happens in between (can't force a transition in
    // a test portably, but the invariant "same local H:MM" must hold).
    const anchor = new Date(2026, 2, 7, 9, 0, 0, 0); // Mar 7, 9:00 local — US DST is Mar 8
    const next = advancePastNow(anchor.getTime(), { kind: "interval", unit: "days", every: 1 }, anchor.getTime());
    const nextDate = new Date(next);
    assertEquals(nextDate.getHours(), 9);
    assertEquals(nextDate.getMinutes(), 0);
    assertEquals(nextDate.getDate(), 8);
  });

  it("weekly recurrence lands on the next requested weekday at the anchor time", () => {
    const monday = new Date(2026, 6, 13, 14, 30, 0, 0); // Mon Jul 13 2026, 14:30 local
    assertEquals(monday.getDay(), 1);
    // Repeat on Wednesdays (3) at 14:30.
    const next = advancePastNow(monday.getTime(), { kind: "weekly", daysOfWeek: [3], hour: 14, minute: 30 }, monday.getTime());
    const nextDate = new Date(next);
    assertEquals(nextDate.getDay(), 3);
    assertEquals(nextDate.getDate(), 15);
    assertEquals(nextDate.getHours(), 14);
    assertEquals(nextDate.getMinutes(), 30);
  });

  it("weekly recurrence on the same weekday advances a full week, not zero days", () => {
    const monday = new Date(2026, 6, 13, 9, 0, 0, 0);
    const next = advancePastNow(monday.getTime(), { kind: "weekly", daysOfWeek: [1], hour: 9, minute: 0 }, monday.getTime());
    assertEquals(new Date(next).getDate(), 20, "next Monday, not today");
  });
});

describe("reconcileMissedSchedule", () => {
  const now = Date.parse("2026-07-12T12:00:00Z");

  it("marks a missed one-shot as skipped instead of letting it fire late", () => {
    const missed = makeSchedule({ runAt: now - HOUR });
    const reconciled = reconcileMissedSchedule(missed, now);
    assertEquals(reconciled.status, "skipped");
  });

  it("silently advances a missed recurring schedule to its next future time", () => {
    const missed = makeSchedule({ runAt: now - 25 * HOUR, recurrence: { kind: "interval", unit: "hours", every: 1 } });
    const reconciled = reconcileMissedSchedule(missed, now);
    assertEquals(reconciled.status, "pending");
    assert(reconciled.runAt > now);
    assertEquals(reconciled.occurrenceCount, 0, "missed occurrences never count as fired");
  });

  it("leaves a still-future pending schedule untouched", () => {
    const future = makeSchedule({ runAt: now + HOUR });
    assertEquals(reconcileMissedSchedule(future, now), future);
  });

  it("leaves non-pending schedules untouched even when past due", () => {
    const fired = makeSchedule({ runAt: now - HOUR, status: "fired" });
    assertEquals(reconcileMissedSchedule(fired, now), fired);
  });
});

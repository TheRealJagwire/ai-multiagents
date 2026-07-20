import {
  catchUpMissedSchedules,
  scheduleDeleteConfirm,
  scheduledModalOpen,
  scheduleError,
  scheduleMsgForm,
  scheduleMsgValidationError,
  sessions,
  sortedSchedules,
} from "../store.ts";
import {
  askDeleteSchedule,
  cancelDeleteSchedule,
  closeScheduledModal,
  confirmDeleteSchedule,
  setCatchUpMissedSchedules,
  setScheduleMsgField,
  submitScheduleMessage,
} from "../actions.ts";
import { formatLocalDateTime, formatRecurrence, formatWhen } from "../format.ts";
import type { Schedule, ScheduleStatus } from "../types.ts";

const inputStyle = {
  border: "1px solid var(--sb-border-3)",
  borderRadius: 9,
  padding: "8px 12px",
  fontSize: 12.5,
  fontFamily: "var(--sb-font-sans)",
  outline: "none",
  color: "var(--sb-text-1)",
};

const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--sb-text-3)" };

const statusColors: Record<ScheduleStatus, { bg: string; text: string }> = {
  pending: { bg: "var(--sb-blue-tint)", text: "var(--sb-blue-dark)" },
  fired: { bg: "var(--sb-running-bg)", text: "var(--sb-running-text)" },
  failed: { bg: "var(--sb-error-bg)", text: "var(--sb-error-text)" },
  skipped: { bg: "var(--sb-surface-3)", text: "var(--sb-text-4)" },
};

function ScheduleRow({ schedule }: { schedule: Schedule }) {
  const colors = statusColors[schedule.status];
  const kindLabel = schedule.payload.kind === "spawn" ? "Spawn" : "Message";
  const recurrenceLabel = formatRecurrence(schedule.recurrence);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid var(--sb-border-2)",
        borderRadius: 9,
        padding: "9px 11px",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {schedule.label}
          </span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".05em",
              color: "var(--sb-text-4)",
              background: "var(--sb-surface-3)",
              padding: "2px 7px",
              borderRadius: 6,
              flex: "none",
            }}
          >
            {kindLabel.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: colors.text,
              background: colors.bg,
              padding: "2px 7px",
              borderRadius: 6,
              flex: "none",
            }}
          >
            {schedule.status}
          </span>
          {recurrenceLabel && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "var(--sb-waiting-text)",
                background: "var(--sb-waiting-bg)",
                padding: "2px 7px",
                borderRadius: 6,
                flex: "none",
              }}
            >
              ↻ recurring
            </span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--sb-text-5)", paddingTop: 2 }}>
          {formatLocalDateTime(schedule.runAt)} · {formatWhen(schedule.runAt)}
          {recurrenceLabel ? ` · ${recurrenceLabel}` : ""}
          {schedule.occurrenceCount > 0 ? ` · fired ${schedule.occurrenceCount}×` : ""}
          {schedule.status === "failed" && schedule.error ? ` — ${schedule.error}` : ""}
          {schedule.status === "skipped" ? " — missed while the app was closed" : ""}
        </div>
      </div>
      {scheduleDeleteConfirm.value === schedule.id
        ? (
          <div style={{ display: "flex", gap: 6, flex: "none" }}>
            <button
              type="button"
              onClick={() => confirmDeleteSchedule(schedule.id)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--sb-on-primary)",
                background: "var(--sb-error-dot)",
                padding: "4px 11px",
                borderRadius: 7,
                cursor: "pointer",
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={cancelDeleteSchedule}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--sb-text-3)",
                border: "1px solid var(--sb-border-3)",
                padding: "4px 11px",
                borderRadius: 7,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )
        : (
          <button
            type="button"
            onClick={() => askDeleteSchedule(schedule.id)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--sb-error-text)",
              border: "1px solid var(--sb-red-tint-4)",
              padding: "4px 11px",
              borderRadius: 7,
              cursor: "pointer",
              flex: "none",
            }}
          >
            {schedule.status === "pending" ? "Cancel" : "Clear"}
          </button>
        )}
    </div>
  );
}

export function ScheduledModal() {
  if (!scheduledModalOpen.value) return null;

  const runningSessions = sessions.value.filter((s) => s.status !== "done" && s.status !== "stopped");
  const msgValidationError = scheduleMsgValidationError.value;

  return (
    <div
      onClick={closeScheduledModal}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--sb-overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sb-sbin"
        style={{
          width: 540,
          maxHeight: "86%",
          overflowY: "auto",
          background: "var(--sb-surface)",
          borderRadius: "var(--sb-radius-modal)",
          boxShadow: "var(--sb-shadow-modal)",
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Scheduled</div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeScheduledModal}
            style={{ fontSize: 16, color: "var(--sb-text-5)", cursor: "pointer", padding: "2px 6px" }}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--sb-text-4)", lineHeight: 1.5 }}>
          New sessions and teams schedule from the "New session"/"New team" form — pick your time there instead of
          starting right away. This is for scheduling a message to a session that's already running.
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            border: "1px solid var(--sb-border-2)",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sb-text-3)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={catchUpMissedSchedules.value}
              onChange={(e) => setCatchUpMissedSchedules((e.target as HTMLInputElement).checked)}
            />
            Catch up on missed schedules when the app starts
          </label>
          <div style={{ fontSize: 11, color: "var(--sb-text-4)", marginLeft: 20 }}>
            {catchUpMissedSchedules.value
              ? "If a schedule was due while the app was closed, it fires as soon as the app opens."
              : "If a schedule was due while the app was closed, a one-off is marked \"skipped\" and a repeating one just advances to its next occurrence — neither fires late."}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            border: "1px solid var(--sb-border-2)",
            borderRadius: 10,
            padding: "14px 14px",
            background: "var(--sb-bg)",
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Schedule a message</div>
          {runningSessions.length === 0
            ? <div style={{ fontSize: 11.5, color: "var(--sb-text-5)" }}>No running sessions to message.</div>
            : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Session</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {runningSessions.map((session) => (
                      <button
                        type="button"
                        key={session.id}
                        onClick={() => setScheduleMsgField({ sessionId: session.id })}
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          padding: "5px 12px",
                          borderRadius: 9,
                          cursor: "pointer",
                          background: scheduleMsgForm.value.sessionId === session.id ? "var(--sb-primary)" : "var(--sb-surface)",
                          color: scheduleMsgForm.value.sessionId === session.id ? "var(--sb-on-primary)" : "var(--sb-text-2)",
                          border: scheduleMsgForm.value.sessionId === session.id ? "none" : "1px solid var(--sb-border-3)",
                        }}
                      >
                        {session.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Message</div>
                  <textarea
                    placeholder="What should it be told when this fires?"
                    value={scheduleMsgForm.value.text}
                    onInput={(e) => setScheduleMsgField({ text: (e.target as HTMLTextAreaElement).value })}
                    style={{ ...inputStyle, resize: "none", height: 60, background: "var(--sb-surface)" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 220 }}>
                  <div style={labelStyle}>When (local time)</div>
                  <input
                    type="datetime-local"
                    value={scheduleMsgForm.value.at}
                    onInput={(e) => setScheduleMsgField({ at: (e.target as HTMLInputElement).value })}
                    style={{ ...inputStyle, background: "var(--sb-surface)" }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    disabled={!!msgValidationError}
                    onClick={submitScheduleMessage}
                    style={{
                      padding: "7px 16px",
                      background: msgValidationError ? "var(--sb-surface-3)" : "var(--sb-primary)",
                      color: msgValidationError ? "var(--sb-text-5)" : "var(--sb-on-primary)",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: msgValidationError ? "not-allowed" : "pointer",
                    }}
                  >
                    Schedule
                  </button>
                  {msgValidationError && <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>{msgValidationError}</span>}
                </div>
                {scheduleError.value && (
                  <div style={{ fontSize: 11.5, color: "var(--sb-error-text)" }}>{scheduleError.value}</div>
                )}
              </>
            )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sortedSchedules.value.length === 0
            ? <div style={{ fontSize: 12, color: "var(--sb-text-5)", padding: "6px 0" }}>Nothing scheduled yet.</div>
            : sortedSchedules.value.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} />)}
        </div>
      </div>
    </div>
  );
}

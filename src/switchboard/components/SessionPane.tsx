import type { Effort, EventResolution, Model } from "../types.ts";
import {
  chatText,
  confirmStop,
  eventsById,
  grants,
  selectedSession,
  selectedTranscript,
  sessionsById,
  teams,
} from "../store.ts";
import {
  approveEvent,
  askStop,
  cancelPendingEffort,
  cancelPendingModel,
  cancelStop,
  closeSession,
  confirmStopSession,
  denyEvent,
  sendMessage,
  setChatText,
  togglePause,
  toggleGrantsPopover,
} from "../actions.ts";
import { chipState, costPhrase, effortLabel, elapsed, formatCost, modelLabel, phaseLabel, statusLabel } from "../format.ts";
import { statusColor } from "../statusColors.ts";
import { chipStyle } from "./TeamMemberRow.tsx";

const MODELS: Model[] = ["haiku", "sonnet", "opus"];
const EFFORTS: Effort[] = ["low", "medium", "high"];
const effortRank: Record<Effort, number> = { low: 0, medium: 1, high: 2 };

function resolvedLabel(resolution: EventResolution): string {
  if (resolution === "approved") return "✓ Approved once — running";
  if (resolution === "allowed") return "✓ Pattern allowed for session — running";
  if (resolution === "denied") return "Denied";
  return "Resolved";
}

export function SessionPane() {
  const session = selectedSession.value;
  if (!session) return null;

  const colors = statusColor(session.status);
  const team = session.teamId ? teams.value.find((t) => t.id === session.teamId) : undefined;
  const teamLead = team ? [...sessionsById.value.values()].find((s) => s.teamId === team.id && s.lead) : undefined;
  const groupLine = team
    ? (session.lead ? `${team.name} · lead` : `${team.name} · reports to ${teamLead?.short ?? "lead"}`)
    : "Independent session";
  const sessionGrantCount = grants.value.filter((g) => g.sid === session.id).length;
  const disablePause = session.status === "done" || session.status === "stopped";

  return (
    <div
      style={{
        width: "clamp(340px, 44vw, 440px)",
        flex: "none",
        background: "var(--sb-surface)",
        borderLeft: "1px solid var(--sb-border-2)",
        boxShadow: "var(--sb-shadow-pane)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      className="sb-sbin"
    >
      <div
        style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid var(--sb-border-2)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="sb-dot" style={{ width: 9, height: 9, background: colors.dot }} />
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{session.name}</span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: colors.text,
              background: colors.bg,
              padding: "2px 9px",
              borderRadius: 10,
              flex: "none",
            }}
          >
            {statusLabel(session.status)}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeSession}
            style={{ fontSize: 16, color: "var(--sb-text-5)", cursor: "pointer", padding: "2px 6px" }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--sb-text-4)", flexWrap: "wrap" }}>
          <span>{groupLine}</span>
          <span>{session.status === "done" ? "finished" : `${session.ctx}% context`}</span>
          <span>{formatCost(session.cost)}</span>
          {sessionGrantCount > 0 && (
            <span onClick={toggleGrantsPopover} style={{ textDecoration: "underline", cursor: "pointer" }}>
              Grants · {sessionGrantCount}
            </span>
          )}
        </div>

        <div className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)" }}>
          {session.worktreePath
            ? `Worktree: ${session.worktreePath} · Branch: ${session.branch}`
            : "Creating worktree…"}
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}
            >
              MODEL
            </span>
            {MODELS.map((m) => (
              <span
                key={m}
                style={{ ...chipStyle(chipState(session.model === m, false)), cursor: "not-allowed" }}
              >
                {modelLabel(m)}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}
            >
              EFFORT
            </span>
            {EFFORTS.map((e) => (
              <span
                key={e}
                style={{ ...chipStyle(chipState(session.effort === e, false)), cursor: "not-allowed" }}
              >
                {effortLabel(e)}
              </span>
            ))}
          </div>
        </div>

        {(session.pendingModel || session.pendingEffort) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {session.pendingModel && (
              <div
                style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, fontWeight: 600, color: "var(--sb-waiting-text)" }}
              >
                <span>
                  ⏳ {modelLabel(session.model)} → {modelLabel(session.pendingModel)} at next step
                  {costPhrase(session.model, session.pendingModel)}
                </span>
                <span
                  onClick={() => cancelPendingModel(session.id)}
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                >
                  cancel
                </span>
              </div>
            )}
            {session.pendingEffort && (
              <div
                style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, fontWeight: 600, color: "var(--sb-waiting-text)" }}
              >
                <span>
                  ⏳ effort {session.effort} → {session.pendingEffort} at next step ·{" "}
                  {effortRank[session.pendingEffort] > effortRank[session.effort] ? "more" : "less"} thinking budget
                </span>
                <span
                  onClick={() => cancelPendingEffort(session.id)}
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                >
                  cancel
                </span>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 3, flex: 1, maxWidth: 150 }}>
            {Array.from({ length: session.msTotal }).map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: i < session.msDone ? colors.dot : "var(--sb-surface-3)",
                }}
              />
            ))}
          </div>
          <span className="sb-mono" style={{ fontSize: 11, color: "var(--sb-text-4)" }}>
            {phaseLabel(session.phase)} · {session.msDone}/{session.msTotal}
            {session.status !== "done" && ` · ${elapsed(session.startedAt)}`}
          </span>
        </div>

        {session.dep && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--sb-waiting-text)",
              background: "var(--sb-waiting-bg)",
              padding: "4px 10px",
              borderRadius: 8,
              width: "fit-content",
            }}
          >
            {session.dep}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, paddingTop: 2 }}>
          <button
            type="button"
            disabled={disablePause}
            onClick={disablePause ? undefined : togglePause.bind(null, session.id)}
            style={{
              padding: "5px 13px",
              border: "1px solid var(--sb-border-3)",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: disablePause ? "not-allowed" : "pointer",
              color: disablePause ? "var(--sb-text-5)" : "var(--sb-text-1)",
            }}
          >
            {session.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            disabled
            style={{
              padding: "5px 13px",
              border: "1px solid var(--sb-border-3)",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "not-allowed",
              color: "var(--sb-text-3)",
            }}
          >
            Hand off
          </button>
          <span style={{ flex: 1 }} />
          {confirmStop.value
            ? (
              <>
                <span style={{ fontSize: 11.5, color: "var(--sb-text-4)", alignSelf: "center" }}>
                  Stop this session?
                </span>
                <button
                  type="button"
                  onClick={() => confirmStopSession(session.id)}
                  style={{
                    padding: "5px 13px",
                    background: "var(--sb-error-dot)",
                    color: "#fff",
                    borderRadius: 7,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Confirm stop
                </button>
                <button
                  type="button"
                  onClick={cancelStop}
                  style={{
                    padding: "5px 13px",
                    border: "1px solid var(--sb-border-3)",
                    borderRadius: 7,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--sb-text-4)",
                    cursor: "pointer",
                  }}
                >
                  Keep running
                </button>
              </>
            )
            : (
              <button
                type="button"
                onClick={askStop}
                style={{
                  padding: "5px 13px",
                  border: "1px solid var(--sb-red-tint-3)",
                  color: "var(--sb-error-text)",
                  borderRadius: 7,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Stop
              </button>
            )}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          background: "var(--sb-bg)",
        }}
      >
        {selectedTranscript.value.map((message, i) => {
          if (message.k === "note") {
            return (
              <div
                key={i}
                style={{
                  alignSelf: "center",
                  textAlign: "center",
                  fontSize: 10.5,
                  color: "var(--sb-text-5)",
                  background: "var(--sb-surface-3)",
                  padding: "3px 10px",
                  borderRadius: 10,
                  width: "fit-content",
                  margin: "0 auto",
                }}
              >
                {message.text}
              </div>
            );
          }
          if (message.k === "text") {
            return (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--sb-text-2)" }}>
                {message.text}
              </div>
            );
          }
          if (message.k === "user") {
            return (
              <div
                key={i}
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "var(--sb-text-1)",
                  background: "var(--sb-surface-3)",
                  borderRadius: 10,
                  padding: "9px 13px",
                  marginLeft: 48,
                }}
              >
                {message.text}
              </div>
            );
          }
          if (message.k === "tool") {
            return (
              <div
                key={i}
                className="sb-mono"
                style={{
                  fontSize: 11,
                  background: "var(--sb-surface-2)",
                  border: "1px solid var(--sb-border-2)",
                  borderRadius: 8,
                  padding: "8px 11px",
                  color: "var(--sb-text-4)",
                }}
              >
                {message.text}
              </div>
            );
          }
          // perm
          const event = message.eventId ? eventsById.value.get(message.eventId) : undefined;
          if (!event) return null;
          return (
            <div
              key={i}
              style={{
                background: "var(--sb-amber-tint-1)",
                border: "1px solid var(--sb-amber-tint-3)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Permission needed</div>
              <div className="sb-mono" style={{ fontSize: 11.5, color: "var(--sb-text-2)", marginBottom: 10 }}>
                {event.command}
              </div>
              {event.resolved === null
                ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => approveEvent(event.id, "once")}
                      style={{
                        padding: "6px 16px",
                        background: "var(--sb-primary)",
                        color: "#fff",
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Approve once
                    </button>
                    <button
                      type="button"
                      onClick={() => denyEvent(event.id)}
                      style={{
                        padding: "6px 16px",
                        border: "1px solid var(--sb-border-3)",
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--sb-text-4)",
                        cursor: "pointer",
                      }}
                    >
                      Deny
                    </button>
                  </div>
                )
                : (
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sb-running-text)" }}>
                    {resolvedLabel(event.resolved)}
                  </div>
                )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          flex: "none",
          borderTop: "1px solid var(--sb-border-2)",
          padding: "12px 20px",
          display: "flex",
          gap: 10,
          alignItems: "center",
          background: "var(--sb-surface)",
        }}
      >
        <input
          placeholder={`Message ${session.short || session.name}…`}
          value={chatText.value}
          onInput={(e) => setChatText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && chatText.value.trim()) {
              sendMessage(session.id, chatText.value.trim());
              chatText.value = "";
            }
          }}
          style={{
            flex: 1,
            border: "1px solid var(--sb-border-3)",
            borderRadius: 9,
            padding: "9px 13px",
            fontSize: 12.5,
            fontFamily: "var(--sb-font-sans)",
            outline: "none",
            color: "var(--sb-text-1)",
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (chatText.value.trim()) {
              sendMessage(session.id, chatText.value.trim());
              chatText.value = "";
            }
          }}
          style={{
            padding: "9px 16px",
            background: "var(--sb-primary)",
            color: "#fff",
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

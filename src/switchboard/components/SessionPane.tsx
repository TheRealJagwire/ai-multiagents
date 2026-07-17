import { useEffect, useRef, useState } from "preact/hooks";
import type { Effort, EventResolution } from "../types.ts";
import {
  chatDrafts,
  confirmStop,
  deleteSessionConfirm,
  eventsById,
  grants,
  now,
  renameDraft,
  selectedSession,
  selectedTranscript,
  sessionsById,
  teams,
} from "../store.ts";
import { useAutoGrow } from "../hooks.ts";
import {
  approveEvent,
  askDeleteSession,
  askStop,
  cancelDeleteSession,
  cancelPendingEffort,
  cancelPendingModel,
  cancelStop,
  cancelRenameSession,
  closeSession,
  commitRenameSession,
  confirmDeleteSession,
  confirmStopSession,
  denyEvent,
  queueModelChange,
  sendMessage,
  setChatText,
  setRenameDraft,
  startRenameSession,
  togglePause,
  toggleGrantsPopover,
} from "../actions.ts";
import { chipState, costPhrase, effortLabel, elapsed, formatCost, modelLabel, phaseLabel, statusLabel } from "../format.ts";
import { statusColor } from "../statusColors.ts";
import { chipStyle } from "./TeamMemberRow.tsx";
import { Markdown } from "./Markdown.tsx";
import { PlanCard } from "./PlanCard.tsx";
import { SessionModelSelect } from "./ModelSelect.tsx";

const TOOL_MESSAGE_PREVIEW_LINES = 4;

function ToolMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const isLong = lines.length > TOOL_MESSAGE_PREVIEW_LINES;
  const shown = expanded || !isLong ? text : lines.slice(0, TOOL_MESSAGE_PREVIEW_LINES).join("\n");

  return (
    <div
      className="sb-mono"
      style={{
        fontSize: 11,
        background: "var(--sb-surface-2)",
        border: "1px solid var(--sb-border-2)",
        borderRadius: 8,
        padding: "8px 11px",
        color: "var(--sb-text-4)",
        whiteSpace: "pre-wrap",
      }}
    >
      {shown}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            display: "block",
            cursor: "pointer",
            color: "var(--sb-blue)",
            fontFamily: "var(--sb-font-sans)",
            fontSize: 10.5,
            marginTop: 5,
          }}
        >
          {expanded ? "Show less" : `Show ${lines.length - TOOL_MESSAGE_PREVIEW_LINES} more lines`}
        </button>
      )}
    </div>
  );
}

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
  const transcript = selectedTranscript.value;
  const transcriptRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const draft = chatDrafts.value[session?.id ?? ""] ?? "";
  const chatRef = useAutoGrow(draft, 130);

  // Switching sessions always jumps to the latest message and re-arms
  // auto-scroll; while a session stays open, a scroll listener tracks
  // whether the user is still near the bottom.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    pinnedToBottomRef.current = true;
    setHasNewBelow(false);
    el.scrollTop = el.scrollHeight;

    const handleScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      pinnedToBottomRef.current = nearBottom;
      if (nearBottom) setHasNewBelow(false);
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [session?.id]);

  // New messages only pull the view down if the user was already reading
  // the bottom of the transcript — otherwise scrolling up to read history
  // would get yanked back down on every streamed line.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    if (pinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setHasNewBelow(true);
    }
  }, [transcript.length]);

  function jumpToBottom(): void {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedToBottomRef.current = true;
    setHasNewBelow(false);
  }

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
          {renameDraft.value !== null
            ? (
              <input
                autofocus
                value={renameDraft.value}
                onInput={(e) => setRenameDraft((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRenameSession(session.id);
                  // Escape must not bubble to the global handler, which
                  // would close the whole pane instead of just the edit.
                  else if (e.key === "Escape") {
                    e.stopPropagation();
                    cancelRenameSession();
                  }
                }}
                onBlur={() => void commitRenameSession(session.id)}
                aria-label="Session name"
                style={{
                  fontSize: 14.5,
                  fontWeight: 700,
                  color: "var(--sb-text-1)",
                  border: "1px solid var(--sb-border-3)",
                  borderRadius: 7,
                  padding: "2px 8px",
                  outline: "none",
                  width: 200,
                }}
              />
            )
            : (
              <button
                type="button"
                onClick={() => startRenameSession(session.baseName)}
                title="Rename session"
                aria-label={`Rename session ${session.name}`}
                style={{ fontSize: 14.5, fontWeight: 700, color: "var(--sb-text-1)", cursor: "text", padding: 0, textAlign: "left" }}
              >
                {session.name}
              </button>
            )}
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
            <button type="button" onClick={toggleGrantsPopover} style={{ textDecoration: "underline", cursor: "pointer" }}>
              Grants · {sessionGrantCount}
            </button>
          )}
        </div>

        <div className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)" }}>
          {!session.useWorktree
            ? `Running in: ${session.dir} (no worktree)`
            : session.worktreePath
            ? `Worktree: ${session.worktreePath} · Branch: ${session.branch}`
            : "Creating worktree…"}
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}
            >
              MODEL
            </span>
            <SessionModelSelect
              model={session.model}
              pendingModel={session.pendingModel}
              disabled={disablePause}
              onChange={(m) => queueModelChange(session.id, m)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }} title="Effort can't change mid-session — only model can">
            <span
              style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}
            >
              EFFORT
            </span>
            {EFFORTS.map((e) => (
              <span
                key={e}
                style={{ ...chipStyle(chipState(session.effort === e, false)), cursor: "not-allowed", opacity: 0.5 }}
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
                <button
                  type="button"
                  onClick={() => cancelPendingModel(session.id)}
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                >
                  cancel
                </button>
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
                <button
                  type="button"
                  onClick={() => cancelPendingEffort(session.id)}
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                >
                  cancel
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="sb-mono" style={{ fontSize: 11, color: "var(--sb-text-4)" }}>
            {phaseLabel(session.phase)}
            {session.status !== "done" && ` · ${elapsed(session.startedAt, now.value)}`}
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
                    color: "var(--sb-on-primary)",
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
            : deleteSessionConfirm.value === session.id
            ? (
              <>
                <span style={{ fontSize: 11.5, color: "var(--sb-text-4)", alignSelf: "center" }}>
                  {session.useWorktree ? "Delete this session? Worktree removed, branch kept." : "Delete this session?"}
                </span>
                <button
                  type="button"
                  onClick={() => confirmDeleteSession(session.id)}
                  style={{
                    padding: "5px 13px",
                    background: "var(--sb-error-dot)",
                    color: "var(--sb-on-primary)",
                    borderRadius: 7,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  onClick={cancelDeleteSession}
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
                  Cancel
                </button>
              </>
            )
            : (
              <>
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
                <button
                  type="button"
                  onClick={() => askDeleteSession(session.id)}
                  style={{
                    padding: "5px 13px",
                    border: "1px solid var(--sb-border-3)",
                    color: "var(--sb-text-3)",
                    borderRadius: 7,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </>
            )}
        </div>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div
        ref={transcriptRef}
        style={{
          height: "100%",
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          background: "var(--sb-bg)",
        }}
      >
        {transcript.map((message, i) => {
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
              <div key={i} style={{ fontSize: 12.5, color: "var(--sb-text-2)" }}>
                <Markdown text={message.text ?? ""} />
              </div>
            );
          }
          if (message.k === "summary") {
            return (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  color: "var(--sb-text-1)",
                  background: "var(--sb-running-bg)",
                  border: "1px solid var(--sb-running-dot)",
                  borderRadius: 10,
                  padding: "10px 13px",
                }}
              >
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".07em",
                    color: "var(--sb-running-text)",
                    marginBottom: 4,
                  }}
                >
                  SUMMARY
                </div>
                <Markdown text={message.text ?? ""} />
              </div>
            );
          }
          if (message.k === "plan") {
            return <PlanCard key={i} text={message.text ?? ""} />;
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
            return <ToolMessage key={i} text={message.text ?? ""} />;
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
              <div className="sb-mono" style={{ fontSize: 11.5, color: "var(--sb-text-2)", marginBottom: 6 }}>
                {event.command}
              </div>
              {session.worktreePath && (
                <div className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)", marginBottom: 10 }}>
                  in {session.worktreePath}
                </div>
              )}
              {event.resolved === null
                ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => approveEvent(event.id, "once")}
                      style={{
                        padding: "6px 16px",
                        background: "var(--sb-primary)",
                        color: "var(--sb-on-primary)",
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
                      onClick={() => approveEvent(event.id, "session")}
                      style={{
                        padding: "6px 16px",
                        border: "1px solid var(--sb-border-3)",
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--sb-text-2)",
                        cursor: "pointer",
                      }}
                    >
                      Allow for session
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
                    {event.grantPattern && (
                      <span className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)" }}>
                        pattern: {event.grantPattern}
                      </span>
                    )}
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
      {hasNewBelow && (
        <button
          type="button"
          onClick={jumpToBottom}
          style={{
            position: "absolute",
            bottom: 14,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 14px",
            background: "var(--sb-primary)",
            color: "var(--sb-on-primary)",
            borderRadius: 20,
            fontSize: 11.5,
            fontWeight: 600,
            boxShadow: "var(--sb-shadow-card)",
            cursor: "pointer",
          }}
        >
          ↓ New messages
        </button>
      )}
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
        <textarea
          ref={chatRef}
          placeholder={`Message ${session.short || session.name}… (Shift+Enter for a new line)`}
          value={draft}
          onInput={(e) => setChatText(session.id, (e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(session.id, draft);
            }
          }}
          rows={1}
          style={{
            flex: 1,
            border: "1px solid var(--sb-border-3)",
            borderRadius: 9,
            padding: "9px 13px",
            fontSize: 12.5,
            fontFamily: "var(--sb-font-sans)",
            outline: "none",
            color: "var(--sb-text-1)",
            resize: "none",
            overflowY: "auto",
          }}
        />
        <button
          type="button"
          onClick={() => sendMessage(session.id, draft)}
          style={{
            padding: "9px 16px",
            background: "var(--sb-primary)",
            color: "var(--sb-on-primary)",
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

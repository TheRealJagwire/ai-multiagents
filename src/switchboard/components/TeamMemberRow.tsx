import type { JSX } from "preact";
import type { Effort, Model, Session } from "../types.ts";
import { deleteSessionConfirm, expandedMemberId, moveConfirm, selectedSessionId, sessions, teams } from "../store.ts";
import {
  askDeleteSession,
  cancelDeleteSession,
  cancelMove,
  cancelMoveConfirm,
  cancelPendingEffort,
  cancelPendingModel,
  confirmDeleteSession,
  makeLead,
  openMoveConfirm,
  openSession,
  queueMove,
  toggleManageExpanded,
} from "../actions.ts";
import { chipState, type ChipState, costPhrase, effortLabel, modelLabel } from "../format.ts";
import { statusColor } from "../statusColors.ts";

const MODELS: Model[] = ["haiku", "sonnet", "opus"];
const EFFORTS: Effort[] = ["low", "medium", "high"];
const effortRank: Record<Effort, number> = { low: 0, medium: 1, high: 2 };

export function chipStyle(state: ChipState): JSX.CSSProperties {
  const base: JSX.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 600,
    padding: "3px 10px",
    borderRadius: 9,
    cursor: "pointer",
  };
  if (state === "current") return { ...base, background: "var(--sb-primary)", color: "#fff", border: "1px solid var(--sb-primary)" };
  if (state === "pending") {
    return { ...base, background: "var(--sb-waiting-bg)", color: "var(--sb-waiting-text)", border: "1px solid var(--sb-waiting-dot)" };
  }
  return { ...base, background: "var(--sb-surface)", color: "var(--sb-text-3)", border: "1px solid var(--sb-border-3)" };
}

interface TeamMemberRowProps {
  session: Session;
  branch?: string;
  showRole: boolean;
}

export function TeamMemberRow({ session, branch, showRole }: TeamMemberRowProps) {
  const colors = statusColor(session.status);
  const expanded = expandedMemberId.value === session.id;
  const selected = selectedSessionId.value === session.id;
  const hasPending = !!(session.pendingModel || session.pendingEffort || session.pendingMove);
  const mc = moveConfirm.value;
  const mcActive = expanded && mc?.sid === session.id;
  const deleteConfirmActive = expanded && deleteSessionConfirm.value === session.id;

  const pendingNotes: { text: string; cancel: () => void }[] = [];
  if (session.pendingModel) {
    pendingNotes.push({
      text: `${modelLabel(session.model)} → ${modelLabel(session.pendingModel)} at next step${
        costPhrase(session.model, session.pendingModel)
      }`,
      cancel: () => cancelPendingModel(session.id),
    });
  }
  if (session.pendingEffort) {
    const more = effortRank[session.pendingEffort] > effortRank[session.effort];
    pendingNotes.push({
      text: `effort ${session.effort} → ${session.pendingEffort} at next step · ${more ? "more" : "less"} thinking budget`,
      cancel: () => cancelPendingEffort(session.id),
    });
  }
  if (session.pendingMove) {
    pendingNotes.push({
      text: `moving to ${session.pendingMove.label} at next step — context handoff`,
      cancel: () => cancelMove(session.id),
    });
  }

  let moveTargetLabel = "";
  const moveLines: { text: string; warn: boolean }[] = [];
  if (mcActive && mc) {
    const targetTeam = mc.target ? teams.value.find((t) => t.id === mc.target) : undefined;
    moveTargetLabel = targetTeam ? targetTeam.name : "Independent";
    const curTeam = session.teamId ? teams.value.find((t) => t.id === session.teamId) : undefined;
    if (targetTeam) {
      const lead = sessions.value.find((s) => s.teamId === targetTeam.id && s.lead);
      moveLines.push({ text: `Finishes its current step, then hands context to ${lead?.short ?? "the team"}.`, warn: false });
    } else {
      moveLines.push({ text: "Finishes its current step, then continues the task solo.", warn: false });
    }
    if (session.dep && curTeam) {
      moveLines.push({ text: `⚠ ${session.short} ${session.dep} — ${curTeam.name} loses this gate.`, warn: true });
    }
    if (session.lead) {
      const heir = sessions.value.find((s) => s.teamId === session.teamId && s.id !== session.id);
      if (heir) moveLines.push({ text: `Lead role passes to ${heir.short}.`, warn: false });
    }
  }

  const otherTeams = teams.value.filter((t) => t.id !== session.teamId);

  return (
    <div>
      <div
        onClick={() => openSession(session.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "8px 10px",
          borderRadius: 8,
          cursor: "pointer",
          background: selected ? "var(--sb-surface-2)" : "transparent",
        }}
      >
        {branch && (
          <span className="sb-mono" style={{ fontSize: 12, color: "var(--sb-border-3)", width: 18, flex: "none" }}>
            {branch}
          </span>
        )}
        <span className="sb-dot" style={{ width: 8, height: 8, background: colors.dot }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{session.name}</span>
        {showRole && <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>{session.lead ? "lead" : "worker"}</span>}
        <span className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)" }}>
          {modelLabel(session.model)}·{session.effort}
          {hasPending && " ⏳"}
        </span>
        {session.dep && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--sb-waiting-text)",
              background: "var(--sb-waiting-bg)",
              padding: "2px 8px",
              borderRadius: 9,
            }}
          >
            {session.dep}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>{session.statusLine}</span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            toggleManageExpanded(session.id);
          }}
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: expanded ? "var(--sb-text-1)" : "var(--sb-text-5)",
            cursor: "pointer",
            padding: "0 5px",
            lineHeight: 1,
          }}
        >
          ⋯
        </span>
      </div>

      {expanded && (
        <div
          className="sb-sbin"
          style={{
            margin: branch ? "2px 0 10px 27px" : "2px 0 10px 10px",
            background: "var(--sb-surface-2)",
            border: "1px solid var(--sb-border-2)",
            borderRadius: 10,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 9,
          }}
        >
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

          {pendingNotes.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {pendingNotes.map((note, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--sb-waiting-text)",
                  }}
                >
                  <span>⏳ {note.text}</span>
                  <span onClick={note.cancel} style={{ cursor: "pointer", textDecoration: "underline" }}>
                    cancel
                  </span>
                </div>
              ))}
            </div>
          )}

          {deleteConfirmActive
            ? (
              <div
                className="sb-sbin"
                style={{
                  background: "var(--sb-red-tint-1)",
                  border: "1px solid var(--sb-red-tint-3)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700 }}>Delete this session?</div>
                <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--sb-text-2)" }}>
                  Terminates it and removes it from every list. Its worktree is removed but the branch is kept.
                </div>
                <div style={{ display: "flex", gap: 8, paddingTop: 3 }}>
                  <span
                    onClick={() => confirmDeleteSession(session.id)}
                    style={{
                      padding: "5px 14px",
                      background: "var(--sb-error-dot)",
                      color: "#fff",
                      borderRadius: 7,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Confirm delete
                  </span>
                  <span
                    onClick={cancelDeleteSession}
                    style={{
                      padding: "5px 14px",
                      border: "1px solid var(--sb-border-3)",
                      background: "var(--sb-surface)",
                      borderRadius: 7,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--sb-text-3)",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </span>
                </div>
              </div>
            )
            : mcActive
            ? (
              <div
                className="sb-sbin"
                style={{
                  background: "var(--sb-amber-tint-1)",
                  border: "1px solid var(--sb-amber-tint-3)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700 }}>Move to {moveTargetLabel}?</div>
                {moveLines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11.5,
                      lineHeight: 1.5,
                      color: line.warn ? "var(--sb-error-text)" : "var(--sb-text-2)",
                      fontWeight: line.warn ? 600 : 400,
                    }}
                  >
                    {line.text}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, paddingTop: 3 }}>
                  <span
                    onClick={() => queueMove(session.id, mc!.target)}
                    style={{
                      padding: "5px 14px",
                      background: "var(--sb-primary)",
                      color: "#fff",
                      borderRadius: 7,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Move at next step
                  </span>
                  <span
                    onClick={cancelMoveConfirm}
                    style={{
                      padding: "5px 14px",
                      border: "1px solid var(--sb-border-3)",
                      background: "var(--sb-surface)",
                      borderRadius: 7,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--sb-text-3)",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </span>
                </div>
              </div>
            )
            : (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                  style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}
                >
                  MOVE
                </span>
                {otherTeams.map((t) => (
                  <span
                    key={t.id}
                    onClick={() => openMoveConfirm(session.id, t.id)}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--sb-text-2)",
                      border: "1px solid var(--sb-border-3)",
                      background: "var(--sb-surface)",
                      padding: "3px 10px",
                      borderRadius: 7,
                      cursor: "pointer",
                    }}
                  >
                    → {t.name}
                  </span>
                ))}
                {session.teamId && (
                  <span
                    onClick={() => openMoveConfirm(session.id, null)}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--sb-text-2)",
                      border: "1px solid var(--sb-border-3)",
                      background: "var(--sb-surface)",
                      padding: "3px 10px",
                      borderRadius: 7,
                      cursor: "pointer",
                    }}
                  >
                    → Independent
                  </span>
                )}
                {showRole && !session.lead && (
                  <span
                    onClick={() => makeLead(session.id)}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--sb-text-2)",
                      border: "1px solid var(--sb-border-3)",
                      background: "var(--sb-surface)",
                      padding: "3px 10px",
                      borderRadius: 7,
                      cursor: "pointer",
                    }}
                  >
                    Make lead
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <span
                  onClick={() => askDeleteSession(session.id)}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--sb-error-text)",
                    border: "1px solid var(--sb-red-tint-3)",
                    padding: "3px 10px",
                    borderRadius: 7,
                    cursor: "pointer",
                  }}
                >
                  Delete
                </span>
              </div>
            )}

          <div style={{ fontSize: 10, color: "var(--sb-text-5)" }}>
            Model & effort are fixed once a session starts · moves apply at the next step boundary
          </div>
        </div>
      )}
    </div>
  );
}

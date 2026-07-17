import type { JSX } from "preact";
import type { Effort, Session } from "../types.ts";
import {
  deleteSessionConfirm,
  expandedMemberId,
  latestPlanBySession,
  moveConfirm,
  now,
  selectedSessionId,
  sessions,
  teams,
} from "../store.ts";
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
  queueModelChange,
  queueMove,
  toggleManageExpanded,
} from "../actions.ts";
import { chipState, type ChipState, costPhrase, effortLabel, elapsed, formatCost, modelLabel, providerModels } from "../format.ts";
import { statusColor } from "../statusColors.ts";
import { PlanCard } from "./PlanCard.tsx";
import { providerOf } from "../types.ts";

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
  if (state === "current") return { ...base, background: "var(--sb-primary)", color: "var(--sb-on-primary)", border: "1px solid var(--sb-primary)" };
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
  const disableModelChange = session.status === "done" || session.status === "stopped";

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
  const plan = latestPlanBySession.value.get(session.id);

  return (
    <div>
      <div
        onClick={() => openSession(session.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openSession(session.id);
          }
        }}
        role="button"
        tabIndex={0}
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
        {/* The at-a-glance metadata the old Sessions tab used to carry —
            this roster row is now the one place to scan the whole fleet. */}
        <span className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)", flex: "none" }}>
          {session.status !== "done" && `${elapsed(session.startedAt, now.value)} · `}
          {formatCost(session.cost)}
        </span>
        <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>{session.statusLine}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleManageExpanded(session.id);
          }}
          aria-label={expanded ? "Collapse session controls" : "Expand session controls"}
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
        </button>
      </div>

      {plan && (
        <div style={{ margin: branch ? "2px 0 8px 27px" : "2px 0 8px 10px" }}>
          <PlanCard text={plan.body ?? ""} compact />
        </div>
      )}

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
                style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}
              >
                MODEL
              </span>
              {providerModels(providerOf(session.model)).map((m) => (
                <button
                  type="button"
                  key={m}
                  disabled={disableModelChange}
                  onClick={disableModelChange ? undefined : () => queueModelChange(session.id, m)}
                  style={{
                    ...chipStyle(chipState(session.model === m, session.pendingModel === m)),
                    cursor: disableModelChange ? "not-allowed" : "pointer",
                    opacity: disableModelChange ? 0.5 : 1,
                  }}
                >
                  {modelLabel(m)}
                </button>
              ))}
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: 5 }}
              title="Effort can't change mid-session — only model can"
            >
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
                  <button type="button" onClick={note.cancel} style={{ cursor: "pointer", textDecoration: "underline" }}>
                    cancel
                  </button>
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
                  {session.useWorktree
                    ? "Terminates it and removes it from every list. Its worktree is removed but the branch is kept."
                    : "Terminates it and removes it from every list."}
                </div>
                <div style={{ display: "flex", gap: 8, paddingTop: 3 }}>
                  <button
                    type="button"
                    onClick={() => confirmDeleteSession(session.id)}
                    style={{
                      padding: "5px 14px",
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
                  </button>
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
                  <button
                    type="button"
                    onClick={() => queueMove(session.id, mc!.target)}
                    style={{
                      padding: "5px 14px",
                      background: "var(--sb-primary)",
                      color: "var(--sb-on-primary)",
                      borderRadius: 7,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Move at next step
                  </button>
                  <button
                    type="button"
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
                  </button>
                </div>
              </div>
            )
            : (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                  style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}
                >
                  MOVE
                </span>
                {otherTeams.map((t) => (
                  <button
                    type="button"
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
                  </button>
                ))}
                {session.teamId && (
                  <button
                    type="button"
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
                  </button>
                )}
                {showRole && !session.lead && (
                  <button
                    type="button"
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
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button
                  type="button"
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
                </button>
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

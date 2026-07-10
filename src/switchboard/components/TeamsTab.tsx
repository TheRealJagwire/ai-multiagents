import { deleteTeamConfirm, now, railGroups, startWorkersConfirm, teams } from "../store.ts";
import {
  askDeleteTeam,
  askStartWorkers,
  cancelDeleteTeam,
  cancelStartWorkers,
  confirmDeleteTeam,
  confirmStartWorkers,
  openSpawnModal,
} from "../actions.ts";
import { elapsed } from "../format.ts";
import { TeamMemberRow } from "./TeamMemberRow.tsx";

const coordinationLabel: Record<string, string> = { sequenced: "Sequenced", autonomous: "Autonomous" };

export function TeamsTab() {
  const independentGroup = railGroups.value.find((g) => g.id === null);

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "20px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, maxWidth: 640, minWidth: 420 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Teams</div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => openSpawnModal("new")}
          style={{
            padding: "6px 14px",
            border: "1px solid var(--sb-border-3)",
            background: "var(--sb-surface)",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            color: "var(--sb-text-3)",
          }}
        >
          + New team
        </button>
      </div>

      {teams.value.map((team) => {
        const group = railGroups.value.find((g) => g.id === team.id);
        const members = group?.sessions ?? [];
        const workers = members.filter((m) => !m.lead);
        return (
          <div
            key={team.id}
            style={{
              background: "var(--sb-surface)",
              border: "1px solid var(--sb-border)",
              borderRadius: "var(--sb-radius-card)",
              padding: "18px 20px",
              maxWidth: 640,
              minWidth: 420,
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{team.name}</span>
              {team.coordination !== "classic" && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".05em",
                    color: "var(--sb-text-4)",
                    background: "var(--sb-surface-3)",
                    padding: "2px 7px",
                    borderRadius: 6,
                  }}
                >
                  {coordinationLabel[team.coordination]}
                </span>
              )}
              <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>
                {members.length} {members.length === 1 ? "agent" : "agents"} · started {elapsed(team.startedAt, now.value)} ago
              </span>
              <span style={{ flex: 1 }} />
              {team.coordination === "sequenced" && !team.workersStarted && startWorkersConfirm.value !== team.id && (
                <button
                  type="button"
                  onClick={() => askStartWorkers(team.id)}
                  style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer" }}
                >
                  Start workers
                </button>
              )}
              <button
                type="button"
                onClick={() => openSpawnModal("existing", team.id)}
                style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer" }}
              >
                + Add member
              </button>
              {deleteTeamConfirm.value !== team.id && (
                <button
                  type="button"
                  onClick={() => askDeleteTeam(team.id)}
                  style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sb-error-text)", cursor: "pointer" }}
                >
                  Delete team
                </button>
              )}
            </div>
            {startWorkersConfirm.value === team.id && (
              <div
                className="sb-sbin"
                style={{
                  background: "var(--sb-surface-2)",
                  border: "1px solid var(--sb-border-3)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 11.5, color: "var(--sb-text-2)", flex: 1 }}>
                  Start workers from the lead's plan? This reads {`SWITCHBOARD_TASKS.md`} from its worktree and
                  spawns one session per task.
                </span>
                <button
                  type="button"
                  onClick={() => confirmStartWorkers(team.id)}
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
                  Start workers
                </button>
                <button
                  type="button"
                  onClick={cancelStartWorkers}
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
            )}
            {deleteTeamConfirm.value === team.id && (
              <div
                className="sb-sbin"
                style={{
                  background: "var(--sb-red-tint-1)",
                  border: "1px solid var(--sb-red-tint-3)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 11.5, color: "var(--sb-text-2)", flex: 1 }}>
                  Delete "{team.name}"? Terminates and removes all {members.length}{" "}
                  {members.length === 1 ? "session" : "sessions"}
                  {team.useWorktree ? " — worktrees removed, branches kept." : "."}
                </span>
                <button
                  type="button"
                  onClick={() => confirmDeleteTeam(team.id)}
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
                  onClick={cancelDeleteTeam}
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
            )}
            <div style={{ fontSize: 12, color: "var(--sb-text-3)", marginBottom: 6 }}>{team.goal}</div>
            <div style={{ fontSize: 10.5, color: "var(--sb-text-5)", fontFamily: "var(--sb-font-mono)", marginBottom: 14 }}>
              {team.dir} · {team.baseRef}
            </div>
            {members.map((session) => (
              <TeamMemberRow
                key={session.id}
                session={session}
                branch={session.lead ? "" : (workers[workers.length - 1]?.id === session.id ? "└" : "├")}
                showRole
              />
            ))}
          </div>
        );
      })}

      <div
        style={{
          background: "var(--sb-surface)",
          border: "1px solid var(--sb-border)",
          borderRadius: "var(--sb-radius-card)",
          padding: "18px 20px",
          maxWidth: 640,
          minWidth: 420,
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>Independent sessions</div>
        {(independentGroup?.sessions.length ?? 0) === 0
          ? <div style={{ fontSize: 12, color: "var(--sb-text-5)" }}>None right now.</div>
          : independentGroup!.sessions.map((session) => (
            <TeamMemberRow key={session.id} session={session} showRole={false} />
          ))}
      </div>
    </div>
  );
}

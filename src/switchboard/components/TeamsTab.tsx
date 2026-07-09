import { railGroups, teams } from "../store.ts";
import { openSpawnModal } from "../actions.ts";
import { elapsed } from "../format.ts";
import { TeamMemberRow } from "./TeamMemberRow.tsx";

export function TeamsTab() {
  const independentGroup = railGroups.value.find((g) => g.id === null);

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "20px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, maxWidth: 640, minWidth: 420 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Teams</div>
        <div style={{ flex: 1 }} />
        <div
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
        </div>
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
              <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>
                {members.length} {members.length === 1 ? "agent" : "agents"} · started {elapsed(team.startedAt)} ago
              </span>
              <span style={{ flex: 1 }} />
              <span
                onClick={() => openSpawnModal("existing", team.id)}
                style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer" }}
              >
                + Add member
              </span>
            </div>
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

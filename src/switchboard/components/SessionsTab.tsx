import { now, sessions } from "../store.ts";
import { openSession } from "../actions.ts";
import { elapsed, formatCost, modelEffortLabel, phaseLabel, statusLabel } from "../format.ts";
import { statusColor } from "../statusColors.ts";

export function SessionsTab() {
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "20px 26px" }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>All sessions</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {sessions.value.map((session) => {
          const colors = statusColor(session.status);
          return (
            <button
              type="button"
              key={session.id}
              onClick={() => openSession(session.id)}
              className="sb-sbin"
              style={{
                background: "var(--sb-surface)",
                border: "1px solid var(--sb-border)",
                borderRadius: "var(--sb-radius-card)",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 9,
                cursor: "pointer",
                boxShadow: "var(--sb-shadow-card)",
                width: "100%",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="sb-dot" style={{ width: 8, height: 8, background: colors.dot }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{session.name}</span>
                <span style={{ flex: 1 }} />
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: colors.text,
                    background: colors.bg,
                    padding: "2px 9px",
                    borderRadius: 10,
                  }}
                >
                  {statusLabel(session.status)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--sb-text-3)", lineHeight: 1.4, minHeight: 34 }}>
                {session.statusLine}
              </div>
              <div
                className="sb-mono"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 10.5,
                  color: "var(--sb-text-5)",
                }}
              >
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {modelEffortLabel(session.model, session.effort)} · {phaseLabel(session.phase)}
                  {session.status !== "done" && ` · ${elapsed(session.startedAt, now.value)}`}
                </span>
                <span style={{ flex: "none" }}>{formatCost(session.cost)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { railGroups, selectedSessionId } from "../store.ts";
import { openSession } from "../actions.ts";
import { statusColor } from "../statusColors.ts";

const statusLineColor = (status: string): string => {
  if (status === "waiting") return "var(--sb-waiting-text)";
  if (status === "error") return "var(--sb-error-text)";
  if (status === "stopped") return "var(--sb-stopped-text)";
  return "var(--sb-text-4)";
};

export function LeftRail() {
  return (
    <div
      style={{
        width: 238,
        background: "var(--sb-surface)",
        borderRight: "1px solid var(--sb-border)",
        overflowY: "auto",
        padding: "14px 10px",
        flex: "none",
      }}
    >
      {railGroups.value.map((group) => (
        <div key={group.id ?? "independent"} style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--sb-text-5)",
              padding: "4px 8px",
            }}
          >
            {group.name}
          </div>
          {group.sessions.map((session) => {
            const colors = statusColor(session.status);
            const selected = selectedSessionId.value === session.id;
            return (
              <div
                key={session.id}
                onClick={() => openSession(session.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: selected ? "var(--sb-surface-3)" : "transparent",
                }}
              >
                <span className="sb-dot" style={{ width: 8, height: 8, background: colors.dot }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: session.lead || selected ? 600 : 400,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {session.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: statusLineColor(session.status),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {session.statusLine}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

import { grants, grantsOpen, now, sessionsById } from "../store.ts";
import { closeGrantsPopover, revokeGrant } from "../actions.ts";
import { relativeTime } from "../format.ts";

export function GrantsPopover() {
  if (!grantsOpen.value) return null;

  return (
    <div
      className="sb-sbin"
      style={{
        position: "absolute",
        top: 10,
        right: 14,
        width: 370,
        background: "var(--sb-surface)",
        border: "1px solid var(--sb-border-3)",
        borderRadius: "var(--sb-radius-card)",
        boxShadow: "var(--sb-shadow-popover)",
        zIndex: 26,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Session permissions</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={closeGrantsPopover}
          style={{ fontSize: 14, color: "var(--sb-text-5)", cursor: "pointer", padding: "2px 5px" }}
        >
          ✕
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--sb-text-4)", lineHeight: 1.45 }}>
        Patterns agents may run without asking. Grants end when their session ends.
      </div>
      {grants.value.length === 0
        ? <div style={{ fontSize: 12, color: "var(--sb-text-5)", padding: "6px 0" }}>No active grants.</div>
        : grants.value.map((grant) => {
          const session = sessionsById.value.get(grant.sid);
          return (
            <div
              key={grant.id}
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
                <div
                  className="sb-mono"
                  style={{
                    fontSize: 11.5,
                    color: "var(--sb-text-1)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {grant.pattern}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--sb-text-5)", paddingTop: 2 }}>
                  {session?.short ?? grant.sid} · granted {relativeTime(grant.grantedAt, now.value)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revokeGrant(grant.id)}
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
                Revoke
              </button>
            </div>
          );
        })}
    </div>
  );
}

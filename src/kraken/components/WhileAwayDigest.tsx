import { awaySince, digestDismissed, events, lastSeen, sessionsById, unreadCount } from "../store.ts";
import { dismissDigest, setSessionFilter } from "../actions.ts";

export function WhileAwayDigest() {
  if (awaySince.value === null || unreadCount.value < 3 || digestDismissed.value) return null;

  const awayMinutes = Math.max(1, Math.round((Date.now() - awaySince.value) / 60_000));
  const unread = events.value.filter((e) => e.ts > lastSeen.value && !e.own).slice(0, 4);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "var(--sb-surface)",
        border: "1px solid var(--sb-blue-tint)",
        borderRadius: "var(--sb-radius-card)",
        padding: "12px 14px",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sb-blue-dark)" }}>
          While you were away
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={dismissDigest}
          style={{ fontSize: 11, color: "var(--sb-text-4)", cursor: "pointer" }}
        >
          Dismiss
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--sb-text-4)" }}>
        {awayMinutes}m away · {unreadCount.value} events
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
        {unread.map((event) => (
          <button
            type="button"
            key={event.id}
            onClick={() => setSessionFilter(event.sid)}
            style={{ fontSize: 12, cursor: "pointer", textAlign: "left" }}
          >
            <b>{sessionsById.value.get(event.sid)?.name ?? event.sid}</b> — {event.verb}
          </button>
        ))}
      </div>
    </div>
  );
}

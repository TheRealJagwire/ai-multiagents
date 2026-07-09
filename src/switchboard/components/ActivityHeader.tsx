import { activeFilter, type ActivityFilter, searchQuery, sessionFilter, sessionsById, unreadCount } from "../store.ts";
import { markCaughtUp, setFilter, setSearchQuery, setSessionFilter } from "../actions.ts";

const filters: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "artifacts", label: "Artifacts" },
  { id: "errors", label: "Errors" },
];

export function ActivityHeader() {
  const filteredSession = sessionFilter.value ? sessionsById.value.get(sessionFilter.value) : undefined;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      <span style={{ fontSize: 15, fontWeight: 700 }}>Activity</span>

      {unreadCount.value > 0 && (
        <span
          style={{
            background: "var(--sb-waiting-dot)",
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 700,
            borderRadius: 10,
            padding: "2px 8px",
          }}
        >
          {unreadCount.value} new
        </span>
      )}

      <span style={{ flex: 1 }} />

      <input
        placeholder="Search events…"
        value={searchQuery.value}
        onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
        style={{
          fontSize: 11.5,
          width: 130,
          padding: "6px 12px",
          borderRadius: "var(--sb-radius-pill)",
          border: "1px solid var(--sb-border-3)",
          background: "var(--sb-surface)",
        }}
      />

      {filteredSession && (
        <span
          onClick={() => setSessionFilter(null)}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#fff",
            background: "var(--sb-blue)",
            borderRadius: "var(--sb-radius-pill)",
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          {filteredSession.short} ✕
        </span>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        {filters.map((f) => (
          <span
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "5px 10px",
              borderRadius: 8,
              cursor: "pointer",
              background: activeFilter.value === f.id ? "var(--sb-primary)" : "transparent",
              color: activeFilter.value === f.id ? "#fff" : "var(--sb-text-3)",
              border: activeFilter.value === f.id ? "none" : "1px solid var(--sb-border-3)",
            }}
          >
            {f.label}
            {f.id === "unread" && unreadCount.value > 0 ? ` · ${unreadCount.value}` : ""}
          </span>
        ))}
      </div>

      {unreadCount.value > 0 && (
        <span
          onClick={markCaughtUp}
          style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer" }}
        >
          Mark caught up
        </span>
      )}
    </div>
  );
}

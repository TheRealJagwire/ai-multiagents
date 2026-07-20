import type { EventKind } from "../types.ts";
import {
  activeFilter,
  type ActivityFilter,
  ALL_EVENT_KINDS,
  kindFilter,
  searchQuery,
  sessionFilter,
  sessionsById,
  unreadCount,
} from "../store.ts";
import { clearKindFilter, markCaughtUp, setFilter, setSearchQuery, setSessionFilter, toggleKindFilter } from "../actions.ts";

const filters: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
];

const kindLabels: Record<EventKind, string> = {
  info: "Info",
  message: "Messages",
  artifact: "Artifacts",
  approval: "Approvals",
  error: "Errors",
  review: "Reviews",
};

export function ActivityHeader() {
  const filteredSession = sessionFilter.value ? sessionsById.value.get(sessionFilter.value) : undefined;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      <span style={{ fontSize: 15, fontWeight: 700 }}>Activity</span>

      {unreadCount.value > 0 && (
        <span
          style={{
            background: "var(--sb-waiting-dot)",
            color: "var(--sb-on-primary)",
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
        <button
          type="button"
          onClick={() => setSessionFilter(null)}
          aria-label={`Clear filter: ${filteredSession.short}`}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--sb-on-primary)",
            background: "var(--sb-blue)",
            borderRadius: "var(--sb-radius-pill)",
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          {filteredSession.short} ✕
        </button>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        {filters.map((f) => (
          <button
            type="button"
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "5px 10px",
              borderRadius: 8,
              cursor: "pointer",
              background: activeFilter.value === f.id ? "var(--sb-primary)" : "transparent",
              color: activeFilter.value === f.id ? "var(--sb-on-primary)" : "var(--sb-text-3)",
              border: activeFilter.value === f.id ? "none" : "1px solid var(--sb-border-3)",
            }}
          >
            {f.label}
            {f.id === "unread" && unreadCount.value > 0 ? ` · ${unreadCount.value}` : ""}
          </button>
        ))}
      </div>

      {/* Kind chips are multi-select: none selected = everything shows;
          picking one or more narrows the feed to just those kinds. */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }} role="group" aria-label="Filter by kind">
        {ALL_EVENT_KINDS.map((kind) => {
          const selected = kindFilter.value.includes(kind);
          return (
            <button
              type="button"
              key={kind}
              onClick={() => toggleKindFilter(kind)}
              aria-pressed={selected}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: "var(--sb-radius-pill)",
                cursor: "pointer",
                background: selected ? "var(--sb-blue)" : "transparent",
                color: selected ? "var(--sb-on-primary)" : "var(--sb-text-3)",
                border: selected ? "none" : "1px solid var(--sb-border-3)",
              }}
            >
              {kindLabels[kind]}
            </button>
          );
        })}
        {kindFilter.value.length > 0 && (
          <button
            type="button"
            onClick={clearKindFilter}
            aria-label="Clear kind filters"
            style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer" }}
          >
            Clear
          </button>
        )}
      </div>

      {unreadCount.value > 0 && (
        <button
          type="button"
          onClick={markCaughtUp}
          style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer" }}
        >
          Mark caught up
        </button>
      )}
    </div>
  );
}

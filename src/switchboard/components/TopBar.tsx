import { activeTab, grants, statusSummary, type Tab } from "../store.ts";
import { openSpawnModal, setActiveTab, toggleGrantsPopover } from "../actions.ts";

const tabs: { id: Tab; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "sessions", label: "Sessions" },
  { id: "teams", label: "Teams" },
];

export function TopBar() {
  return (
    <div
      style={{
        height: 52,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 20px",
        borderBottom: "1px solid var(--sb-border)",
        background: "var(--sb-surface)",
        flex: "none",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.01em" }}>Switchboard</div>

      <div style={{ display: "flex", gap: 2, background: "var(--sb-surface-3)", borderRadius: 8, padding: 2 }}>
        {tabs.map((tab) => {
          const active = activeTab.value === tab.id;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                background: active ? "#fff" : "transparent",
                color: active ? "var(--sb-text-1)" : "var(--sb-text-3)",
                boxShadow: active ? "0 1px 2px rgba(0,0,0,.06)" : "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--sb-text-3)" }}>
        <span
          className="sb-dot sb-pulse"
          style={{ width: 7, height: 7, background: "var(--sb-running-dot)" }}
        />
        {statusSummary.value}
      </div>

      {grants.value.length > 0 && (
        <button
          type="button"
          onClick={toggleGrantsPopover}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--sb-border-3)",
            borderRadius: 8,
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--sb-text-3)",
            cursor: "pointer",
          }}
        >
          Grants · {grants.value.length}
        </button>
      )}

      <button
        type="button"
        onClick={() => openSpawnModal("solo")}
        style={{
          padding: "7px 14px",
          background: "var(--sb-primary)",
          color: "#fff",
          borderRadius: 8,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        + New session
      </button>
    </div>
  );
}

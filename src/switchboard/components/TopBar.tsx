import { activeTab, grants, needsYouCount, pendingScheduleCount, runningCount, type Tab, theme, type ThemeMode } from "../store.ts";
import { goToPinned, openScheduledModal, openSettingsModal, openSpawnModal, setActiveTab, setTheme, toggleGrantsPopover } from "../actions.ts";

const tabs: { id: Tab; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "sessions", label: "Sessions" },
  { id: "teams", label: "Teams" },
];

const THEME_CYCLE: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON: Record<ThemeMode, string> = { system: "◐", light: "☀", dark: "☾" };
const THEME_LABEL: Record<ThemeMode, string> = { system: "Auto", light: "Light", dark: "Dark" };

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
                background: active ? "var(--sb-tab-active-bg)" : "transparent",
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

      {(() => {
        const needsYou = needsYouCount.value;
        const running = runningCount.value;
        // Attention beats activity: a pinned decision waiting on you outranks
        // "something is running" as the signal worth pulsing for. With
        // nothing running and nothing waiting, the dot goes static — a
        // pulsing dot with zero activity was signaling life that wasn't there.
        const dotColor = needsYou > 0 ? "var(--sb-waiting-dot)" : running > 0 ? "var(--sb-running-dot)" : "var(--sb-text-5)";
        const pulsing = needsYou > 0 || running > 0;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--sb-text-3)" }}>
            <span
              className={pulsing ? "sb-dot sb-pulse" : "sb-dot"}
              style={{ width: 7, height: 7, background: dotColor }}
            />
            <span>{running} running · </span>
            {needsYou > 0
              ? (
                <button
                  type="button"
                  onClick={goToPinned}
                  style={{ cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                >
                  {needsYou} need you
                </button>
              )
              : <span>{needsYou} need you</span>}
          </div>
        );
      })()}

      <button
        type="button"
        onClick={() => setTheme(THEME_CYCLE[theme.value])}
        aria-label={`Theme: ${THEME_LABEL[theme.value]} (click to change)`}
        title={`Theme: ${THEME_LABEL[theme.value]}`}
        style={{
          padding: "6px 10px",
          border: "1px solid var(--sb-border-3)",
          borderRadius: 8,
          fontSize: 12.5,
          color: "var(--sb-text-3)",
          cursor: "pointer",
        }}
      >
        {THEME_ICON[theme.value]}
      </button>

      <button
        type="button"
        onClick={openSettingsModal}
        aria-label="Settings"
        title="Settings"
        style={{
          padding: "6px 10px",
          border: "1px solid var(--sb-border-3)",
          borderRadius: 8,
          fontSize: 12.5,
          color: "var(--sb-text-3)",
          cursor: "pointer",
        }}
      >
        ⚙
      </button>

      <button
        type="button"
        onClick={openScheduledModal}
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
        Scheduled{pendingScheduleCount.value > 0 ? ` · ${pendingScheduleCount.value}` : ""}
      </button>

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
          color: "var(--sb-on-primary)",
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

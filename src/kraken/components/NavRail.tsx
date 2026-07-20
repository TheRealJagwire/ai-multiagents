import { activeTab, grants, needsYouCount, pendingScheduleCount, runningCount, type Tab, theme, type ThemeMode } from "../store.ts";
import { goToPinned, openScheduledModal, openSettingsSection, openSpawnModal, setActiveTab, setTheme, toggleGrantsPopover } from "../actions.ts";
import type { SettingsSection } from "../store.ts";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "feed", icon: "☰", label: "Feed" },
  { id: "teams", icon: "⚇", label: "Teams" },
];

const SETTINGS: { section: SettingsSection; icon: string; label: string }[] = [
  { section: "general", icon: "⌂", label: "General" },
  { section: "mcp", icon: "⌁", label: "MCP servers" },
  { section: "skills", icon: "✦", label: "Skills" },
  { section: "subagents", icon: "❖", label: "Subagents" },
];

const THEME_CYCLE: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON: Record<ThemeMode, string> = { system: "◐", light: "☀", dark: "☾" };
const THEME_LABEL: Record<ThemeMode, string> = { system: "Auto", light: "Light", dark: "Dark" };

function RailButton(
  { icon, label, active, badge, onClick }: {
    icon: string;
    label: string;
    active?: boolean;
    badge?: number;
    onClick: () => void;
  },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label + (badge ? ` (${badge})` : "")}
      style={{
        position: "relative",
        width: 36,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        fontSize: 15,
        cursor: "pointer",
        background: active ? "var(--sb-tab-active-bg)" : "transparent",
        color: active ? "var(--sb-text-1)" : "var(--sb-text-4)",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,.06)" : "none",
      }}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            minWidth: 14,
            height: 14,
            padding: "0 3px",
            borderRadius: 7,
            background: "var(--sb-waiting-dot)",
            color: "var(--sb-on-primary)",
            fontSize: 8.5,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 22, height: 1, background: "var(--sb-border)", margin: "4px 0" }} />;
}

// Icon-only vertical app bar (replaces the old horizontal TopBar). Every
// button is tooltip-labeled (title + aria-label); settings categories get
// individual entries instead of one gear.
export function NavRail() {
  const needsYou = needsYouCount.value;
  const running = runningCount.value;
  const dotColor = needsYou > 0 ? "var(--sb-waiting-dot)" : running > 0 ? "var(--sb-running-dot)" : "var(--sb-text-5)";
  const pulsing = needsYou > 0 || running > 0;
  const statusLabel = `${running} running · ${needsYou} need you`;

  return (
    <div
      style={{
        width: 52,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "10px 0",
        borderRight: "1px solid var(--sb-border)",
        background: "var(--sb-surface)",
      }}
    >
      <div title="Kraken" style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, cursor: "default" }}>◈</div>

      {TABS.map((tab) => (
        <RailButton
          key={tab.id}
          icon={tab.icon}
          label={tab.label}
          active={activeTab.value === tab.id}
          onClick={() => setActiveTab(tab.id)}
        />
      ))}

      <Divider />

      {SETTINGS.map((entry) => (
        <RailButton
          key={entry.section}
          icon={entry.icon}
          label={`Settings: ${entry.label}`}
          onClick={() => openSettingsSection(entry.section)}
        />
      ))}

      <Divider />

      <RailButton icon="◷" label="Scheduled" badge={pendingScheduleCount.value} onClick={openScheduledModal} />
      {grants.value.length > 0 && (
        <RailButton icon="❈" label="Grants" badge={grants.value.length} onClick={toggleGrantsPopover} />
      )}

      <span style={{ flex: 1 }} />

      <button
        type="button"
        onClick={goToPinned}
        title={statusLabel}
        aria-label={statusLabel}
        style={{ width: 36, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: needsYou > 0 ? "pointer" : "default" }}
      >
        <span className={pulsing ? "sb-dot sb-pulse" : "sb-dot"} style={{ width: 8, height: 8, background: dotColor }} />
      </button>

      <RailButton icon={THEME_ICON[theme.value]} label={`Theme: ${THEME_LABEL[theme.value]}`} onClick={() => setTheme(THEME_CYCLE[theme.value])} />

      <button
        type="button"
        onClick={() => openSpawnModal("solo")}
        title="New session"
        aria-label="New session"
        style={{
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 9,
          background: "var(--sb-primary)",
          color: "var(--sb-on-primary)",
          fontSize: 17,
          fontWeight: 600,
          cursor: "pointer",
          marginTop: 4,
        }}
      >
        +
      </button>
    </div>
  );
}

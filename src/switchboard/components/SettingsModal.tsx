import { type SettingsSection, settingsSection } from "../store.ts";
import { closeSettingsModal } from "../actions.ts";
import { ApiKeySection } from "./ApiKeySection.tsx";
import { GeneralSection } from "./GeneralSection.tsx";
import { McpConfigsSection } from "./McpConfigsSection.tsx";
import { SkillsSection } from "./SkillsSection.tsx";
import { SubagentsSection } from "./SubagentsSection.tsx";

const TITLES: Record<SettingsSection, string> = {
  general: "General",
  "api-keys": "API keys",
  mcp: "MCP servers",
  skills: "Skills",
  subagents: "Subagents",
};

// One modal, one section at a time — each nav-rail settings button opens
// its own category directly (there is no combined settings screen).
export function SettingsModal() {
  const section = settingsSection.value;
  if (section === null) return null;

  return (
    <div
      onClick={closeSettingsModal}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--sb-overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sb-sbin"
        style={{
          width: 560,
          maxHeight: "86%",
          overflowY: "auto",
          background: "var(--sb-surface)",
          borderRadius: "var(--sb-radius-modal)",
          boxShadow: "var(--sb-shadow-modal)",
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{TITLES[section]}</div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeSettingsModal}
            style={{ fontSize: 16, color: "var(--sb-text-5)", cursor: "pointer", padding: "2px 6px" }}
          >
            ✕
          </button>
        </div>

        {section === "general" && <GeneralSection />}
        {section === "api-keys" && <ApiKeySection />}
        {section === "mcp" && <McpConfigsSection />}
        {section === "skills" && <SkillsSection />}
        {section === "subagents" && <SubagentsSection />}
      </div>
    </div>
  );
}

import { keyboardHelpOpen } from "../store.ts";
import { closeKeyboardHelp } from "../actions.ts";

const shortcuts: [string, string][] = [
  ["j / k", "Move focus down / up through pinned decisions"],
  ["y", "Approve the focused decision once"],
  ["Y", "Approve the focused decision — allow this pattern for the rest of the session"],
  ["n", "Deny the focused decision"],
  ["Esc", "Close whatever's open"],
  ["?", "Toggle this help"],
];

export function KeyboardHelp() {
  if (!keyboardHelpOpen.value) return null;

  return (
    <div
      onClick={closeKeyboardHelp}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--sb-overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sb-sbin"
        style={{
          width: 380,
          background: "var(--sb-surface)",
          borderRadius: "var(--sb-radius-modal)",
          boxShadow: "var(--sb-shadow-modal)",
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Keyboard shortcuts</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeKeyboardHelp}
            style={{ fontSize: 15, color: "var(--sb-text-5)", cursor: "pointer", padding: "2px 6px" }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shortcuts.map(([key, desc]) => (
            <div key={key} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span
                className="sb-mono"
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: "var(--sb-text-2)",
                  background: "var(--sb-surface-3)",
                  padding: "2px 8px",
                  borderRadius: 6,
                  flex: "none",
                  minWidth: 44,
                  textAlign: "center",
                }}
              >
                {key}
              </span>
              <span style={{ fontSize: 12, color: "var(--sb-text-3)", lineHeight: 1.4 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

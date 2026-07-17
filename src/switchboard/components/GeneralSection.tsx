import { defaultDirDraft, defaultDirectory, defaultDirError, defaultDirSaving } from "../store.ts";
import { clearDefaultDirectory, saveDefaultDirectory } from "../actions.ts";
import { ApiKeySection } from "./ApiKeySection.tsx";

const inputStyle = {
  border: "1px solid var(--sb-border-3)",
  borderRadius: 9,
  padding: "8px 12px",
  fontSize: 12.5,
  fontFamily: "var(--sb-font-mono)",
  outline: "none",
  color: "var(--sb-text-1)",
  flex: 1,
};

// Both settings here are single, small, machine-scoped preferences that
// don't warrant their own nav-rail entry each — one "General" panel covers
// them together instead.
export function GeneralSection() {
  const configured = defaultDirectory.value !== null;
  const saving = defaultDirSaving.value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ApiKeySection />

      <div style={{ height: 1, background: "var(--sb-border)" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Default directory</div>
        <div style={{ fontSize: 11.5, color: "var(--sb-text-4)", lineHeight: 1.5 }}>
          When set, spawning a new session or team offers a "use default directory" option instead of typing a path
          out each time.
        </div>

        <div style={{ fontSize: 11.5, fontWeight: 600, color: configured ? "var(--sb-text-3)" : "var(--sb-text-5)" }}>
          {configured ? `Currently set: ${defaultDirectory.value}` : "No default directory set."}
        </div>

        <form
          style={{ display: "flex", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) void saveDefaultDirectory();
          }}
        >
          <input
            placeholder="/absolute/path/to/repo"
            autocomplete="off"
            value={defaultDirDraft.value}
            onInput={(e) => {
              defaultDirDraft.value = (e.target as HTMLInputElement).value;
            }}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "7px 14px",
              background: "var(--sb-primary)",
              color: "var(--sb-on-primary)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.5 : 1,
            }}
          >
            Save
          </button>
        </form>

        {defaultDirError.value && (
          <div style={{ fontSize: 11.5, color: "var(--sb-error-text, #c33)" }}>{defaultDirError.value}</div>
        )}

        {configured && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void clearDefaultDirectory()}
            style={{
              alignSelf: "flex-start",
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--sb-text-3)",
              border: "1px solid var(--sb-border-3)",
              borderRadius: 8,
              padding: "5px 10px",
              cursor: saving ? "default" : "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

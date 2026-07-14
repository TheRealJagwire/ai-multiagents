import { apiKeyConfigured, apiKeyDraft, apiKeyError, apiKeySaving, apiKeyTail } from "../store.ts";
import { clearApiKey, saveApiKey } from "../actions.ts";

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

export function ApiKeySection() {
  const configured = apiKeyConfigured.value;
  const saving = apiKeySaving.value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>Anthropic API key</div>
      <div style={{ fontSize: 11.5, color: "var(--sb-text-4)", lineHeight: 1.5 }}>
        Used by every session spawned after saving. Without one, sessions use your <code>claude login</code>{" "}
        credentials (or an <code>ANTHROPIC_API_KEY</code> already set in the server's environment). The key is stored
        on this machine only and never shown again after saving.
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 600, color: configured ? "var(--sb-text-3)" : "var(--sb-text-5)" }}>
        {configured ? `Currently configured: sk-ant-…${apiKeyTail.value ?? ""}` : "No key configured."}
      </div>

      <form
        style={{ display: "flex", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving && apiKeyDraft.value.trim()) void saveApiKey();
        }}
      >
        <input
          type="password"
          placeholder="sk-ant-…"
          autocomplete="off"
          value={apiKeyDraft.value}
          onInput={(e) => {
            apiKeyDraft.value = (e.target as HTMLInputElement).value;
          }}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={saving || !apiKeyDraft.value.trim()}
          style={{
            padding: "7px 14px",
            background: "var(--sb-primary)",
            color: "var(--sb-on-primary)",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: saving || !apiKeyDraft.value.trim() ? "default" : "pointer",
            opacity: saving || !apiKeyDraft.value.trim() ? 0.5 : 1,
          }}
        >
          {configured ? "Replace" : "Save"}
        </button>
      </form>

      {apiKeyError.value && <div style={{ fontSize: 11.5, color: "var(--sb-error-text, #c33)" }}>{apiKeyError.value}</div>}

      {configured && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void clearApiKey()}
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
          Remove key
        </button>
      )}

      <div style={{ fontSize: 11, color: "var(--sb-text-5)", lineHeight: 1.5 }}>
        Already-running sessions keep the credentials they started with; the change applies from the next spawn.
      </div>
    </div>
  );
}

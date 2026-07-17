import type { Signal } from "@preact/signals";
import {
  apiKeyConfigured,
  apiKeyDraft,
  apiKeyError,
  apiKeySaving,
  apiKeyTail,
  geminiKeyConfigured,
  geminiKeyDraft,
  geminiKeyError,
  geminiKeySaving,
  geminiKeyTail,
} from "../store.ts";
import { clearApiKey, clearGeminiKey, saveApiKey, saveGeminiKey } from "../actions.ts";

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

interface KeyConfig {
  title: string;
  blurb: string;
  placeholder: string;
  tailPrefix: string;
  noKeyLine: string;
  configured: Signal<boolean>;
  tail: Signal<string | null>;
  draft: Signal<string>;
  saving: Signal<boolean>;
  error: Signal<string | null>;
  save: () => Promise<void>;
  clear: () => Promise<void>;
}

// One form per provider key, same look and behavior — both render inside
// Settings › General (GeneralSection.tsx).
function KeyForm({ config }: { config: KeyConfig }) {
  const configured = config.configured.value;
  const saving = config.saving.value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{config.title}</div>
      <div style={{ fontSize: 11.5, color: "var(--sb-text-4)", lineHeight: 1.5 }}>{config.blurb}</div>

      <div style={{ fontSize: 11.5, fontWeight: 600, color: configured ? "var(--sb-text-3)" : "var(--sb-text-5)" }}>
        {configured ? `Currently configured: ${config.tailPrefix}${config.tail.value ?? ""}` : config.noKeyLine}
      </div>

      <form
        style={{ display: "flex", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving && config.draft.value.trim()) void config.save();
        }}
      >
        <input
          type="password"
          placeholder={config.placeholder}
          autocomplete="off"
          value={config.draft.value}
          onInput={(e) => {
            config.draft.value = (e.target as HTMLInputElement).value;
          }}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={saving || !config.draft.value.trim()}
          style={{
            padding: "7px 14px",
            background: "var(--sb-primary)",
            color: "var(--sb-on-primary)",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: saving || !config.draft.value.trim() ? "default" : "pointer",
            opacity: saving || !config.draft.value.trim() ? 0.5 : 1,
          }}
        >
          {configured ? "Replace" : "Save"}
        </button>
      </form>

      {config.error.value && <div style={{ fontSize: 11.5, color: "var(--sb-error-text, #c33)" }}>{config.error.value}</div>}

      {configured && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void config.clear()}
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
    </div>
  );
}

export function ApiKeySection() {
  return (
    <KeyForm
      config={{
        title: "Anthropic API key",
        blurb: "Used by every Claude session spawned after saving. Without one, sessions use your claude login " +
          "credentials (or an ANTHROPIC_API_KEY already set in the server's environment). The key is stored on " +
          "this machine only and never shown again after saving. Already-running sessions keep the credentials " +
          "they started with.",
        placeholder: "sk-ant-…",
        tailPrefix: "sk-ant-…",
        noKeyLine: "No key configured.",
        configured: apiKeyConfigured,
        tail: apiKeyTail,
        draft: apiKeyDraft,
        saving: apiKeySaving,
        error: apiKeyError,
        save: saveApiKey,
        clear: clearApiKey,
      }}
    />
  );
}

export function GeminiKeySection() {
  return (
    <KeyForm
      config={{
        title: "Gemini API key",
        blurb: "Used by Gemini-model sessions (Google ADK runtime). Required — unlike Claude, there is no " +
          "login-based fallback. The key is stored on this machine only and never shown again after saving.",
        placeholder: "AIza…",
        tailPrefix: "AIza…",
        noKeyLine: "No key configured — Gemini sessions won't start without one.",
        configured: geminiKeyConfigured,
        tail: geminiKeyTail,
        draft: geminiKeyDraft,
        saving: geminiKeySaving,
        error: geminiKeyError,
        save: saveGeminiKey,
        clear: clearGeminiKey,
      }}
    />
  );
}

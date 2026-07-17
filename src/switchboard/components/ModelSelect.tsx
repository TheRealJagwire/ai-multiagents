import { type Model, type Provider, providerOf } from "../types.ts";
import { modelLabel, providerModels } from "../format.ts";

const PROVIDER_LABELS: Record<Provider, string> = { claude: "Claude", gemini: "Gemini" };
const PROVIDERS: Provider[] = ["claude", "gemini"];

interface ModelSelectProps {
  value: Model;
  onChange: (model: Model) => void;
  // When set, only this provider's models are offered — a running session
  // can't switch runtimes, so its model-change picker stays within its
  // provider. Omit to offer every model, grouped by provider.
  restrictToProvider?: Provider;
  disabled?: boolean;
  // Styles the box as a queued change (amber) rather than the current value.
  pending?: boolean;
}

// One grouped dropdown for choosing a model, replacing the old row of chips —
// with five models across two providers, optgroups read better than a wall
// of buttons. Used wherever a model is picked: spawn, subagent presets, and
// live session model changes.
export function ModelSelect({ value, onChange, restrictToProvider, disabled, pending }: ModelSelectProps) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value as Model)}
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "5px 8px",
        borderRadius: 8,
        border: `1px solid ${pending ? "var(--sb-waiting-dot)" : "var(--sb-border-3)"}`,
        background: pending ? "var(--sb-waiting-bg)" : "var(--sb-surface)",
        color: pending ? "var(--sb-waiting-text)" : "var(--sb-text-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        outline: "none",
      }}
    >
      {restrictToProvider
        ? providerModels(restrictToProvider).map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)
        : PROVIDERS.map((p) => (
          <optgroup key={p} label={PROVIDER_LABELS[p]}>
            {providerModels(p).map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
          </optgroup>
        ))}
    </select>
  );
}

// Convenience for the live-session model picker: restricts to the session's
// own provider and reflects any queued (pending) change.
export function SessionModelSelect(
  { model, pendingModel, disabled, onChange }: {
    model: Model;
    pendingModel: Model | null;
    disabled?: boolean;
    onChange: (model: Model) => void;
  },
) {
  return (
    <ModelSelect
      value={pendingModel ?? model}
      pending={pendingModel !== null}
      restrictToProvider={providerOf(model)}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

interface FactChipsProps {
  verified?: string[];
  claimed?: string[];
}

export function FactChips({ verified, claimed }: FactChipsProps) {
  if (!verified?.length && !claimed?.length) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {verified?.map((text) => (
        <span
          key={`v-${text}`}
          title="Verified by the sandbox"
          style={{
            fontSize: 11,
            background: "var(--sb-green-tint)",
            color: "var(--sb-running-text)",
            borderRadius: "var(--sb-radius-chip)",
            padding: "3px 9px",
          }}
        >
          ✓ {text}
        </span>
      ))}
      {claimed?.map((text) => (
        <span
          key={`c-${text}`}
          title="Claimed by the agent — not verified"
          style={{
            fontSize: 11,
            background: "var(--sb-surface)",
            color: "var(--sb-text-4)",
            border: "1px dashed var(--sb-border-3)",
            borderRadius: "var(--sb-radius-chip)",
            padding: "3px 9px",
          }}
        >
          agent: {text}
        </span>
      ))}
    </div>
  );
}

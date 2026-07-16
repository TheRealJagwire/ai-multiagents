import { planBullets } from "../format.ts";

interface PlanCardProps {
  text: string;
  compact?: boolean;
}

// Shared "plan as a bulleted list" presentation for both a session's own
// transcript (SessionPane) and its roster row (TeamMemberRow) — one visual
// language for "this session proposed a plan" wherever it surfaces.
export function PlanCard({ text, compact }: PlanCardProps) {
  const items = planBullets(text);
  if (items.length === 0) return null;

  return (
    <div
      className="sb-sbin"
      style={{
        fontSize: compact ? 11.5 : 12,
        color: "var(--sb-text-1)",
        background: "var(--sb-running-bg)",
        border: "1px solid var(--sb-running-dot)",
        borderRadius: 10,
        padding: compact ? "8px 11px" : "10px 13px",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: ".07em",
          color: "var(--sb-running-text)",
          marginBottom: 5,
        }}
      >
        PLAN
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((item, i) => (
          <li key={i} style={{ lineHeight: 1.5, color: "var(--sb-text-2)" }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

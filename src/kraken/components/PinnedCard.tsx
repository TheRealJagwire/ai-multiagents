import type { ComponentChildren } from "preact";
import type { EventKind, FeedEvent } from "../types.ts";
import { now, sessionsById } from "../store.ts";
import { applyAltFix, approveArtifact, approveEvent, denyEvent, openReview, openSession, retryEvent } from "../actions.ts";
import { relativeTime } from "../format.ts";
import { statusColor } from "../statusColors.ts";
import { FactChips } from "./FactChips.tsx";

const accents: Partial<Record<EventKind, { edge: string; border: string }>> = {
  approval: { edge: "var(--sb-waiting-dot)", border: "var(--sb-amber-tint-3)" },
  error: { edge: "var(--sb-error-dot)", border: "var(--sb-red-tint-3)" },
  review: { edge: "var(--sb-blue)", border: "var(--sb-blue-tint)" },
};

interface PinnedCardProps {
  event: FeedEvent;
  focused?: boolean;
}

export function PinnedCard({ event, focused }: PinnedCardProps) {
  const session = sessionsById.value.get(event.sid);
  const accent = accents[event.kind] ?? accents.approval!;

  return (
    <div
      className="sb-sbin"
      style={{
        background: "var(--sb-surface)",
        borderRadius: "var(--sb-radius-card)",
        padding: "14px 16px",
        boxShadow: focused ? "0 0 0 2px var(--sb-blue), var(--sb-shadow-pinned)" : "var(--sb-shadow-pinned)",
        border: `1px solid ${accent.border}`,
        borderLeft: `3px solid ${accent.edge}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="sb-dot"
          style={{
            width: 8,
            height: 8,
            background: session ? statusColor(session.status).dot : "var(--sb-text-5)",
          }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{session?.name ?? event.sid}</span>
        <span style={{ fontSize: 11.5, color: "var(--sb-text-5)" }}>{event.verb}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--sb-text-6)" }}>{relativeTime(event.ts, now.value)}</span>
      </div>

      {event.why && (
        <div style={{ fontSize: 12, color: "var(--sb-text-3)" }}>
          <b>Why:</b> {event.why}
        </div>
      )}

      {event.command && (
        <div
          className="sb-mono"
          style={{
            fontSize: 12,
            background: "var(--sb-surface-2)",
            border: "1px solid var(--sb-border-2)",
            borderRadius: 8,
            padding: "9px 12px",
          }}
        >
          {event.command}
        </div>
      )}

      {event.kind === "approval" && session?.worktreePath && (
        <div className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)" }}>
          in {session.worktreePath}
        </div>
      )}

      <FactChips verified={event.chipsV} claimed={event.chipsC} />

      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
        {event.kind === "approval" && (
          <>
            <PinnedButton primary onClick={() => approveEvent(event.id, "once")}>
              Approve once
            </PinnedButton>
            <PinnedButton onClick={() => approveEvent(event.id, "session")}>
              Allow this pattern for session
            </PinnedButton>
            <PinnedButton onClick={() => denyEvent(event.id)}>Deny</PinnedButton>
            {event.grantPattern && (
              <span className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)" }}>
                pattern: {event.grantPattern}
              </span>
            )}
          </>
        )}
        {event.kind === "error" && (
          <>
            <PinnedButton primary onClick={() => retryEvent(event.id)}>Retry now</PinnedButton>
            {event.altFix && (
              <PinnedButton onClick={() => applyAltFix(event.id)}>{event.altFix}</PinnedButton>
            )}
            <PinnedButton onClick={() => openSession(event.sid)}>Open session</PinnedButton>
          </>
        )}
        {event.kind === "review" && (
          <>
            <PinnedButton primary onClick={() => openReview(event.id)}>Open review</PinnedButton>
            <PinnedButton muted onClick={() => approveArtifact(event.id)}>Approve without reading</PinnedButton>
          </>
        )}
      </div>
    </div>
  );
}

function PinnedButton(
  { primary, muted, onClick, children }: {
    primary?: boolean;
    muted?: boolean;
    onClick?: () => void;
    children: ComponentChildren;
  },
) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        padding: "6px 12px",
        borderRadius: 7,
        cursor: onClick ? "pointer" : "not-allowed",
        background: primary ? "var(--sb-primary)" : "transparent",
        color: primary ? "var(--sb-on-primary)" : muted ? "var(--sb-text-3)" : "var(--sb-text-1)",
        border: primary ? "none" : "1px solid var(--sb-border-3)",
      }}
    >
      {children}
    </button>
  );
}

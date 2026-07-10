import type { JSX } from "preact";
import type { ArtifactPreviewStyle, FeedEvent } from "../types.ts";
import { lastSeen, now, sessionsById } from "../store.ts";
import { openReview } from "../actions.ts";
import { relativeTime } from "../format.ts";
import { statusColor } from "../statusColors.ts";
import { FactChips } from "./FactChips.tsx";
import { Markdown } from "./Markdown.tsx";

interface EventCardProps {
  event: FeedEvent;
}

export const previewStyles: Record<ArtifactPreviewStyle, JSX.CSSProperties> = {
  h: { fontSize: 15, fontWeight: 700 },
  s: { fontSize: 12.5, fontWeight: 700 },
  n: { fontSize: 12.5, color: "var(--sb-text-2)", lineHeight: 1.55 },
  c: {
    fontSize: 12.5,
    color: "var(--sb-text-2)",
    background: "var(--sb-amber-tint-1)",
    borderLeft: "2px solid var(--sb-waiting-dot)",
    paddingLeft: 8,
  },
  m: { fontSize: 12, color: "var(--sb-text-5)", fontStyle: "italic" },
};

export function EventCard({ event }: EventCardProps) {
  const session = sessionsById.value.get(event.sid);
  const unread = event.ts > lastSeen.value && !event.own;

  return (
    <div
      className="sb-sbin"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: unread ? "var(--sb-unread-bg)" : "var(--sb-surface)",
        borderRadius: "var(--sb-radius-card)",
        padding: "14px 16px",
        boxShadow: "var(--sb-shadow-card)",
        borderLeft: unread ? "2px solid var(--sb-waiting-dot)" : "2px solid transparent",
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

      {event.body && (
        <div style={{ fontSize: 12.5, color: "var(--sb-text-2)" }}>
          <Markdown text={event.body} />
        </div>
      )}

      <FactChips verified={event.chipsV} claimed={event.chipsC} />

      {event.artName && (
        <button
          type="button"
          onClick={() => openReview(event.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--sb-surface-2)",
            borderRadius: 8,
            padding: "8px 10px",
            cursor: "pointer",
            width: "100%",
            textAlign: "left",
          }}
        >
          <div
            className="sb-mono"
            style={{
              width: 30,
              height: 36,
              borderRadius: "var(--sb-radius-icon)",
              background: "var(--sb-surface-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--sb-text-4)",
              flex: "none",
            }}
          >
            {event.artExt?.toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{event.artName}</div>
            <div style={{ fontSize: 11, color: "var(--sb-text-5)" }}>{event.artMeta}</div>
          </div>
        </button>
      )}

      {event.artPreview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {event.artPreview.map(([text, style], i) => (
            <div key={i} style={previewStyles[style]}>{text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

import type { FeedEvent } from "../types.ts";
import { lastSeen, now, sessionsById } from "../store.ts";
import { setSessionFilter } from "../actions.ts";
import { relativeTime } from "../format.ts";
import { statusColor } from "../statusColors.ts";

interface EventRowProps {
  event: FeedEvent;
}

export function EventRow({ event }: EventRowProps) {
  const session = sessionsById.value.get(event.sid);
  const unread = event.ts > lastSeen.value && !event.own;

  return (
    <div
      className="sb-sbin"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 4px",
        fontSize: 12,
        borderLeft: unread ? "2px solid var(--sb-waiting-dot)" : "2px solid transparent",
        background: unread ? "var(--sb-unread-bg)" : "transparent",
      }}
    >
      <span
        className="sb-dot"
        style={{
          width: 6,
          height: 6,
          background: session ? statusColor(session.status).dot : "var(--sb-text-5)",
        }}
      />
      <button type="button" onClick={() => setSessionFilter(event.sid)} style={{ fontWeight: 600, cursor: "pointer" }}>
        {session?.name ?? event.sid}
      </button>
      <span style={{ color: "var(--sb-text-4)" }}>{event.verb}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: "var(--sb-text-6)" }}>{relativeTime(event.ts, now.value)}</span>
    </div>
  );
}

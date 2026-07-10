import type { ComponentChildren } from "preact";
import { activeFilter, feedWindowSize, filteredStream, lastSeen, sessionFilter, sessions } from "../store.ts";
import { expandFeedWindow, openSpawnModal } from "../actions.ts";
import { PinnedBlock } from "./PinnedBlock.tsx";
import { ActivityHeader } from "./ActivityHeader.tsx";
import { WhileAwayDigest } from "./WhileAwayDigest.tsx";
import { EventRow } from "./EventRow.tsx";
import { EventCard } from "./EventCard.tsx";

function isCompact(kind: string, resolved: unknown): boolean {
  return kind === "info" || resolved !== null;
}

export function FeedView() {
  const stream = filteredStream.value;
  const windowed = stream.slice(0, feedWindowSize.value);
  const hiddenCount = stream.length - windowed.length;
  const unfiltered = !sessionFilter.value && activeFilter.value === "all";
  const dividerIndex = unfiltered ? windowed.findIndex((e) => e.ts <= lastSeen.value) : -1;

  const nodes: ComponentChildren[] = [];
  windowed.forEach((event, i) => {
    if (i === dividerIndex && dividerIndex > 0) {
      nodes.push(<CaughtUpDivider key="divider" />);
    }
    nodes.push(
      isCompact(event.kind, event.resolved)
        ? <EventRow key={event.id} event={event} />
        : <EventCard key={event.id} event={event} />,
    );
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "18px 26px" }}>
      <PinnedBlock />
      <ActivityHeader />
      <WhileAwayDigest />

      {stream.length === 0 && sessions.value.length === 0 && (
        <div style={{ textAlign: "center", padding: "56px 0" }}>
          <div style={{ fontSize: 13.5, color: "var(--sb-text-3)", marginBottom: 16 }}>
            Nothing's running yet. Spawn a session or a team to get started.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => openSpawnModal("solo")}
              style={{
                padding: "7px 16px",
                background: "var(--sb-primary)",
                color: "var(--sb-on-primary)",
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + New session
            </button>
            <button
              type="button"
              onClick={() => openSpawnModal("new")}
              style={{
                padding: "7px 16px",
                border: "1px solid var(--sb-border-3)",
                background: "var(--sb-surface)",
                color: "var(--sb-text-3)",
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + New team
            </button>
          </div>
        </div>
      )}

      {stream.length === 0 && sessions.value.length > 0 && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--sb-text-5)", padding: "40px 0" }}>
          Nothing here — you're all caught up.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{nodes}</div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={expandFeedWindow}
          style={{
            display: "block",
            margin: "14px auto 0",
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--sb-blue)",
            cursor: "pointer",
          }}
        >
          Show {Math.min(hiddenCount, 150)} more
        </button>
      )}
    </div>
  );
}

function CaughtUpDivider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
      <div style={{ flex: 1, height: 1, background: "var(--sb-border)" }} />
      <span style={{ fontSize: 10.5, letterSpacing: ".06em", color: "var(--sb-text-5)" }}>
        CAUGHT UP TO HERE
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--sb-border)" }} />
    </div>
  );
}

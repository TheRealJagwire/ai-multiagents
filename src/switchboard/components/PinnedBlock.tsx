import { focusedPinnedId, pinnedShowAll, pinnedSorted } from "../store.ts";
import { togglePinnedShowAll } from "../actions.ts";
import { PinnedCard } from "./PinnedCard.tsx";

export function PinnedBlock() {
  const pinned = pinnedSorted.value;
  if (pinned.length === 0) return null;

  const visible = pinnedShowAll.value ? pinned : pinned.slice(0, 2);
  const hiddenCount = pinned.length - visible.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Needs you</span>
        <span
          style={{
            background: "var(--sb-waiting-dot)",
            color: "var(--sb-on-primary)",
            borderRadius: "50%",
            width: 18,
            height: 18,
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {pinned.length}
        </span>
        <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>oldest first · pinned until you decide</span>
      </div>

      {visible.map((event) => (
        <PinnedCard key={event.id} event={event} focused={event.id === focusedPinnedId.value} />
      ))}

      {pinned.length > 2 && (
        <button
          type="button"
          onClick={togglePinnedShowAll}
          style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer" }}
        >
          {pinnedShowAll.value ? "Collapse" : `+${hiddenCount} more waiting — show all`}
        </button>
      )}

      <div style={{ fontSize: 10.5, color: "var(--sb-text-6)" }}>
        j/k navigate · y approve once · Y allow for session · n deny · ? for shortcuts
      </div>
    </div>
  );
}

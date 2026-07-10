import { eventsById, reviewOpen, revComment, sessionsById } from "../store.ts";
import { approveArtifact, closeReview, requestChanges, setRevComment } from "../actions.ts";
import { previewStyles } from "./EventCard.tsx";
import { useAutoGrow } from "../hooks.ts";

function resolvedLabel(kind: string, resolved: string | null): string | null {
  if (resolved === "approved-art") return "✓ Approved by you";
  if (resolved === "changes-req") return "Changes requested — the agent is revising";
  if (resolved !== null) return "Resolved";
  if (kind === "artifact") return "Delivered — no review needed";
  return null;
}

export function ReviewModal() {
  const event = reviewOpen.value ? eventsById.value.get(reviewOpen.value) : undefined;
  if (!event) return null;

  const owner = sessionsById.value.get(event.sid);
  const meta = [owner?.short, event.artMeta].filter(Boolean).join(" · ");
  const status = resolvedLabel(event.kind, event.resolved);
  const noteRef = useAutoGrow(revComment.value, 130);

  return (
    <div
      onClick={closeReview}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--sb-overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sb-sbin"
        style={{
          width: 600,
          maxHeight: "86%",
          background: "var(--sb-surface)",
          borderRadius: "var(--sb-radius-modal)",
          boxShadow: "var(--sb-shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 20px",
            borderBottom: "1px solid var(--sb-border-2)",
          }}
        >
          <div
            className="sb-mono"
            style={{
              width: 30,
              height: 36,
              background: "var(--sb-surface-2)",
              border: "1px solid var(--sb-border-3)",
              borderRadius: "var(--sb-radius-icon)",
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--sb-text-5)",
            }}
          >
            {event.artExt?.toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{event.artName}</div>
            <div style={{ fontSize: 11, color: "var(--sb-text-5)" }}>{meta}</div>
          </div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeReview}
            style={{ fontSize: 16, color: "var(--sb-text-5)", cursor: "pointer", padding: "2px 6px" }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "18px 22px",
            background: "var(--sb-bg)",
            display: "flex",
            flexDirection: "column",
            gap: 7,
          }}
        >
          {(event.artPreview ?? []).map(([text, style], i) => (
            <div key={i} style={previewStyles[style]}>{text}</div>
          ))}
        </div>

        <div
          style={{
            flex: "none",
            borderTop: "1px solid var(--sb-border-2)",
            padding: "14px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "var(--sb-surface)",
          }}
        >
          {event.resolved === null
            ? (
              <>
                <textarea
                  ref={noteRef}
                  placeholder="Optional note for the agent… (Shift+Enter for a new line)"
                  value={revComment.value}
                  onInput={(e) => setRevComment((e.target as HTMLTextAreaElement).value)}
                  rows={1}
                  style={{
                    border: "1px solid var(--sb-border-3)",
                    borderRadius: 9,
                    padding: "9px 13px",
                    fontSize: 12.5,
                    fontFamily: "var(--sb-font-sans)",
                    outline: "none",
                    color: "var(--sb-text-1)",
                    resize: "none",
                    overflowY: "auto",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => approveArtifact(event.id)}
                    style={{
                      padding: "7px 18px",
                      background: "var(--sb-primary)",
                      color: "var(--sb-on-primary)",
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Approve artifact
                  </button>
                  <button
                    type="button"
                    onClick={() => requestChanges(event.id)}
                    style={{
                      padding: "7px 16px",
                      border: "1px solid var(--sb-border-3)",
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--sb-text-2)",
                      cursor: "pointer",
                    }}
                  >
                    Request changes
                  </button>
                </div>
              </>
            )
            : status && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--sb-text-3)" }}>{status}</div>}
        </div>
      </div>
    </div>
  );
}

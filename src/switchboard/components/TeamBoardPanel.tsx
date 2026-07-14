import { useEffect, useState } from "preact/hooks";
import { type BoardAgent, type BoardCard, createBoard, fetchBoardAgents, fetchBoardCards } from "../api.ts";

const POLL_MS = 4000;

// Column order mirrors the card lifecycle; every status is shown so a card
// can never silently vanish from the visual.
const COLUMNS: { status: BoardCard["status"]; label: string; dot: string }[] = [
  { status: "backlog", label: "Backlog", dot: "var(--sb-text-6)" },
  { status: "ready", label: "Ready", dot: "var(--sb-blue)" },
  { status: "in_progress", label: "In progress", dot: "var(--sb-running-dot)" },
  { status: "review", label: "Review", dot: "var(--sb-waiting-dot)" },
  { status: "blocked", label: "Blocked", dot: "var(--sb-error-dot)" },
  { status: "done", label: "Done", dot: "var(--sb-done-dot)" },
];

// Live kanban for the orchestration board a team is working (Team.boardSlug).
// Self-contained polling while mounted — TeamsTab only renders on the Teams
// tab, so nothing polls in the background.
export function TeamBoardPanel({ slug }: { slug: string }) {
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [agents, setAgents] = useState<BoardAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Bumped to force an immediate re-poll (e.g. right after creating the
  // board) instead of waiting out the 4s timer.
  const [pollNonce, setPollNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const [nextCards, nextAgents] = await Promise.all([fetchBoardCards(slug), fetchBoardAgents(slug)]);
        if (cancelled) return;
        setCards(nextCards);
        setAgents(nextAgents);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [slug, pollNonce]);

  // The linked board not existing yet is a first-run state, not a fault:
  // .mcp.json names the board, but someone still has to create it once.
  const boardMissing = error !== null && error.includes("unknown board");

  const createLinkedBoard = async () => {
    setCreating(true);
    try {
      await createBoard(slug);
      setError(null);
      setPollNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const agentName = (id: string | undefined) => (id ? agents.find((a) => a.id === id)?.name ?? id.slice(-6).toLowerCase() : null);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", color: "var(--sb-text-4)" }}>BOARD</span>
        <span className="sb-mono" style={{ fontSize: 10.5, color: "var(--sb-text-5)" }}>{slug}</span>
        {error && !boardMissing && <span style={{ fontSize: 10.5, color: "var(--sb-error-text)" }}>· {error}</span>}
      </div>

      {boardMissing && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px dashed var(--sb-border-3)",
            borderRadius: 9,
            padding: "10px 12px",
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--sb-text-4)", flex: 1 }}>
            The repo's .mcp.json points at board "{slug}", but it hasn't been created on the orchestration server yet.
          </span>
          <button
            type="button"
            disabled={creating}
            onClick={() => void createLinkedBoard()}
            style={{
              padding: "5px 13px",
              background: "var(--sb-primary)",
              color: "var(--sb-on-primary)",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: creating ? "default" : "pointer",
              opacity: creating ? 0.6 : 1,
              flex: "none",
            }}
          >
            {creating ? "Creating…" : `Create board`}
          </button>
        </div>
      )}

      {cards === null && !error && <div style={{ fontSize: 11.5, color: "var(--sb-text-5)" }}>Loading board…</div>}

      {cards !== null && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {COLUMNS.map((column) => {
            const columnCards = cards
              .filter((c) => c.status === column.status)
              .sort((a, b) => a.priority - b.priority);
            return (
              <div
                key={column.status}
                style={{
                  flex: "1 0 120px",
                  minWidth: 120,
                  background: "var(--sb-surface-2)",
                  border: "1px solid var(--sb-border-2)",
                  borderRadius: 9,
                  padding: "8px 8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7 }}>
                  <span className="sb-dot" style={{ width: 6, height: 6, background: column.dot }} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", color: "var(--sb-text-4)" }}>
                    {column.label.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--sb-text-5)", marginLeft: "auto" }}>{columnCards.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {columnCards.map((card) => {
                    const holder = agentName(card.assignee);
                    return (
                      <div
                        key={card.id}
                        title={card.title}
                        style={{
                          background: "var(--sb-surface)",
                          border: "1px solid var(--sb-border-2)",
                          borderRadius: 7,
                          padding: "6px 8px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            lineHeight: 1.35,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {card.title}
                        </div>
                        {holder && (
                          <div style={{ fontSize: 9.5, color: "var(--sb-text-5)", marginTop: 3 }}>{holder}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

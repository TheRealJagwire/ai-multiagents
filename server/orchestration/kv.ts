// Deno KV storage for the orchestration server. Shares the desktop app's
// app-data root with kraken's persisted files (schedules.json,
// settings.json) — same app, same machine, one place to look — but keeps
// its own subdirectory since a Deno KV database is a directory of files,
// not something you'd want interleaved with kraken's JSON blobs.

import { join } from "jsr:@std/path";
import { appDataDir } from "../kraken/app-data-dir.ts";

let kvPromise: Promise<Deno.Kv> | null = null;

export function getKv(): Promise<Deno.Kv> {
  if (!kvPromise) {
    kvPromise = (async () => {
      const dir = join(appDataDir(), "orchestration");
      await Deno.mkdir(dir, { recursive: true });
      return await Deno.openKv(join(dir, "kv.db"));
    })();
  }
  return kvPromise;
}

// Key layout (see agent-kanban-orchestration-plan-v2-1.md section 3). Every
// record additionally carries its own boardId field, so records are
// self-describing even outside the context of a range scan.
export const keys = {
  board: (boardId: string) => ["boards", boardId] as const,
  boardBySlug: (slug: string) => ["idx", "boards_by_slug", slug] as const,
  boardsPrefix: () => ["boards"] as const,

  card: (boardId: string, cardId: string) => ["cards", boardId, cardId] as const,
  cardsPrefix: (boardId: string) => ["cards", boardId] as const,
  cardByStatus: (boardId: string, status: string, cardId: string) =>
    ["idx", boardId, "cards_by_status", status, cardId] as const,
  cardsByStatusPrefix: (boardId: string, status: string) => ["idx", boardId, "cards_by_status", status] as const,
  cardByAgent: (boardId: string, agentId: string, cardId: string) =>
    ["idx", boardId, "cards_by_agent", agentId, cardId] as const,
  cardsByAgentPrefix: (boardId: string, agentId: string) => ["idx", boardId, "cards_by_agent", agentId] as const,

  agent: (boardId: string, agentId: string) => ["agents", boardId, agentId] as const,
  agentsPrefix: (boardId: string) => ["agents", boardId] as const,
  agentByName: (boardId: string, name: string) => ["idx", boardId, "agents_by_name", name] as const,
  // Deliberately global (not board-prefixed) — a pure routing pointer, not
  // board data, so an MCP tool call carrying only an agent_id (no board arg)
  // can resolve "which board is this agent on" in one lookup. See plan
  // section 5's board-resolution order.
  agentBoardIndex: (agentId: string) => ["idx", "agent_id_to_board", agentId] as const,

  inbox: (boardId: string, agentId: string, messageId: string) => ["inbox", boardId, agentId, messageId] as const,
  inboxPrefix: (boardId: string, agentId: string) => ["inbox", boardId, agentId] as const,
  broadcast: (boardId: string, messageId: string) => ["broadcast", boardId, messageId] as const,
  broadcastPrefix: (boardId: string) => ["broadcast", boardId] as const,

  event: (boardId: string, eventId: string) => ["events", boardId, eventId] as const,
  eventsPrefix: (boardId: string) => ["events", boardId] as const,
  cursor: (boardId: string, agentId: string) => ["cursors", boardId, agentId, "events"] as const,
  // Broadcasts are a shared ring buffer, not per-agent inboxes — each agent
  // needs its own "how far have I read" pointer into it, separate from the
  // events cursor above.
  broadcastCursor: (boardId: string, agentId: string) => ["cursors", boardId, agentId, "broadcast"] as const,
};

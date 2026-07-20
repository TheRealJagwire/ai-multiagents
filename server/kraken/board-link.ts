// Links a Kraken team to the orchestration server's kanban board for
// its repo. The convention already exists: a repo that participates in a
// board commits a .mcp.json whose server URL carries ?board=<slug> (see
// this repo's own .mcp.json and plan section 7) — so the team's directory
// tells us its board without asking the user to repeat themselves.

import { join } from "jsr:@std/path";

// Pure parser, exported for tests: given .mcp.json text, find the first
// MCP server whose URL carries a ?board= query param.
export function parseBoardSlug(mcpJsonText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(mcpJsonText);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (servers === null || typeof servers !== "object") return null;

  for (const server of Object.values(servers as Record<string, unknown>)) {
    if (server === null || typeof server !== "object") continue;
    const url = (server as { url?: unknown }).url;
    if (typeof url !== "string") continue;
    try {
      const slug = new URL(url).searchParams.get("board");
      if (slug) return slug;
    } catch {
      // not a parseable URL — keep looking
    }
  }
  return null;
}

export async function detectBoardSlug(dir: string): Promise<string | null> {
  try {
    return parseBoardSlug(await Deno.readTextFile(join(dir, ".mcp.json")));
  } catch {
    return null; // no .mcp.json (or unreadable) — simply not board-linked
  }
}

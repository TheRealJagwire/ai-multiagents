import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { parseBoardSlug } from "./board-link.ts";

describe("parseBoardSlug", () => {
  it("extracts the slug from a ?board= server URL", () => {
    const text = JSON.stringify({
      mcpServers: { board: { type: "http", url: "http://localhost:8000/api/orchestration/mcp?board=ai-multiagents" } },
    });
    assertEquals(parseBoardSlug(text), "ai-multiagents");
  });

  it("scans past servers without a board param", () => {
    const text = JSON.stringify({
      mcpServers: {
        other: { type: "http", url: "https://example.com/mcp" },
        stdio: { type: "stdio", command: "npx" },
        board: { type: "http", url: "http://localhost:8000/api/orchestration/mcp?board=egg-hunt" },
      },
    });
    assertEquals(parseBoardSlug(text), "egg-hunt");
  });

  it("returns null for malformed JSON, missing mcpServers, or unparseable URLs", () => {
    assertEquals(parseBoardSlug("{nope"), null);
    assertEquals(parseBoardSlug("{}"), null);
    assertEquals(parseBoardSlug(JSON.stringify({ mcpServers: { x: { url: "not a url" } } })), null);
    assertEquals(parseBoardSlug(JSON.stringify({ mcpServers: null })), null);
  });
});

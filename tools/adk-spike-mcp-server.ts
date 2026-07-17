// Trivial stdio MCP server used only by tools/adk-spike.ts to verify that
// ADK's MCPToolset can discover and expose tools from a child process under
// Deno (spike check (h)). Exposes one tool, `ping`, that echoes its input.
// Not part of the app — a test fixture the spike spawns.

import { McpServer } from "npm:@modelcontextprotocol/sdk@^1.29.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@^1.29.0/server/stdio.js";
import { z } from "npm:zod@^4.4.3";

const server = new McpServer({ name: "spike-mcp", version: "0.0.1" });

server.registerTool(
  "ping",
  {
    description: "Replies pong with the given note.",
    inputSchema: { note: z.string() },
  },
  ({ note }: { note: string }) => ({ content: [{ type: "text" as const, text: `pong: ${note}` }] }),
);

await server.connect(new StdioServerTransport());

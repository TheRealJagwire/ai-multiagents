// MCP servers for ADK-driven (Gemini) sessions. The Claude driver hands its
// MCP configs straight to the SDK; ADK instead exposes MCP through its
// MCPToolset, which we drive ourselves so every discovered tool goes through
// the same human-approval gate as our built-in coding tools.
//
// Approval parity is the whole point: MCPToolset would otherwise let the
// model call remote tools with no prompt. We discover the tools, then wrap
// each in a BaseTool subclass whose runAsync gates first, then delegates.

import { BaseTool, MCPToolset } from "npm:@google/adk@^1.3.0";
import type { McpConfig } from "../../src/switchboard/types.ts";
import { state } from "./state.ts";
import { pushFeedEvent } from "./mutations.ts";
import { gateToolCall } from "./adk-tools.ts";

// ADK exposes two connection kinds: Stdio (local child process) and
// StreamableHTTP (which also carries SSE-style streaming), so both of this
// app's "http" and "sse" transports map to StreamableHTTP.
// deno-lint-ignore no-explicit-any
type MCPConnectionParams = any;

// Pure mapping — exported for unit testing without touching ADK or the network.
export function mcpConfigToConnectionParams(config: McpConfig): MCPConnectionParams {
  if (config.transport === "stdio") {
    return {
      type: "StdioConnectionParams",
      serverParams: {
        command: config.command,
        ...(config.args.length ? { args: config.args } : {}),
        ...(Object.keys(config.env).length ? { env: config.env } : {}),
      },
    };
  }
  return {
    type: "StreamableHTTPConnectionParams",
    url: config.url,
    ...(Object.keys(config.headers).length ? { transportOptions: { requestInit: { headers: config.headers } } } : {}),
  };
}

// A function-name-safe token from a server's display name, used as the ADK
// tool-name prefix so two servers (or a server and our coding tools) can't
// collide on a tool name.
function prefixFor(config: McpConfig): string {
  const slug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || `mcp_${config.id}`;
}

// Wraps a discovered MCP tool so the model's call is gated before it reaches
// the server. Delegates _getDeclaration (the model sees the real schema) and
// gates runAsync. McpTool only overrides those two methods — processLlmRequest
// is inherited and drives off _getDeclaration — so this thin subclass behaves
// identically to the wrapped tool, minus the approval step.
class GatedMcpTool extends BaseTool {
  #inner: BaseTool;
  #sid: string;
  #serverName: string;

  constructor(inner: BaseTool, sid: string, serverName: string) {
    super({ name: inner.name, description: inner.description, isLongRunning: inner.isLongRunning });
    this.#inner = inner;
    this.#sid = sid;
    this.#serverName = serverName;
  }

  override _getDeclaration() {
    return this.#inner._getDeclaration();
  }

  override async runAsync(request: { args: Record<string, unknown>; toolContext: unknown }): Promise<unknown> {
    const decision = await gateToolCall(
      this.#sid,
      this.name,
      `${this.name}(${JSON.stringify(request.args)})`,
      `MCP tool from "${this.#serverName}".`,
    );
    if (!decision.allow) return { error: decision.message };
    // deno-lint-ignore no-explicit-any
    return this.#inner.runAsync(request as any);
  }
}

export interface McpToolsetBundle {
  tools: BaseTool[];
  // Kept so the driver can close every session it opened when the session ends.
  toolsets: MCPToolset[];
}

// Builds gated tools for the session's configured MCP servers. Best-effort,
// mirroring the Claude driver's tolerance: a config whose server can't be
// reached is a feed-event warning and a skip, never a failed spawn. Configs
// deleted between spawn and lookup are silently skipped (same as
// buildMcpServers in agent-sessions.ts).
export async function buildMcpToolsets(sid: string, mcpConfigIds: string[]): Promise<McpToolsetBundle> {
  const tools: BaseTool[] = [];
  const toolsets: MCPToolset[] = [];

  for (const id of mcpConfigIds) {
    const config = state.mcpConfigs.find((c) => c.id === id);
    if (!config) continue;
    try {
      const toolset = new MCPToolset(mcpConfigToConnectionParams(config), undefined, prefixFor(config));
      const discovered = await toolset.getTools();
      for (const tool of discovered) tools.push(new GatedMcpTool(tool, sid, config.name));
      toolsets.push(toolset);
    } catch (err) {
      pushFeedEvent({ sid, kind: "error", own: false, verb: `couldn't connect to MCP server "${config.name}": ${String(err)}` });
    }
  }

  return { tools, toolsets };
}

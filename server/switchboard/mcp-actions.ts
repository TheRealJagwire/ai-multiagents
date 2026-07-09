import type { McpConfig, McpTransport } from "../../src/switchboard/types.ts";
import { nextId, state } from "./state.ts";
import { pushMcpConfigsReplace } from "./mutations.ts";

export interface McpConfigInput {
  name: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
}

export function addMcpConfig(input: McpConfigInput): McpConfig {
  const config: McpConfig = {
    id: nextId("mcp"),
    name: input.name.trim() || "Unnamed server",
    transport: input.transport,
    command: input.command.trim(),
    args: input.args,
    env: input.env,
    url: input.url.trim(),
    headers: input.headers,
  };
  pushMcpConfigsReplace([...state.mcpConfigs, config]);
  return config;
}

export function deleteMcpConfig(id: string): void {
  pushMcpConfigsReplace(state.mcpConfigs.filter((c) => c.id !== id));
  // Sessions/teams that already reference this id just silently drop it —
  // spawn-time lookups filter to configs that still exist (see
  // agent-sessions.ts), so a deleted config never breaks an in-flight spawn.
}

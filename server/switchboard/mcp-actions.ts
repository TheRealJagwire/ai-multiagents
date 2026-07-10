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

// Editing a config only ever affects future spawns — sessions already
// running hold their own resolved mcpServers snapshot from spawn time (see
// agent-sessions.ts's buildMcpServers), so there's nothing to migrate here.
export function updateMcpConfig(id: string, input: McpConfigInput): McpConfig | null {
  const existing = state.mcpConfigs.find((c) => c.id === id);
  if (!existing) return null;

  const updated: McpConfig = {
    id,
    name: input.name.trim() || "Unnamed server",
    transport: input.transport,
    command: input.command.trim(),
    args: input.args,
    env: input.env,
    url: input.url.trim(),
    headers: input.headers,
  };
  pushMcpConfigsReplace(state.mcpConfigs.map((c) => (c.id === id ? updated : c)));
  return updated;
}

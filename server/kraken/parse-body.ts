// Shared JSON-body parsing helpers for kraken routes. Split out from
// routes.ts so spawn-actions.ts (spawnFromBody, used by both the live
// POST /sessions route and the scheduler) can reuse them without routes.ts
// and schedule-actions.ts ending up in an import cycle.

import type { Effort, McpTransport, Model, TeamCoordination } from "../../src/kraken/types.ts";

export const MODELS: Model[] = ["haiku", "sonnet", "opus", "gemini-flash", "gemini-pro"];
export const EFFORTS: Effort[] = ["low", "medium", "high"];
export const MCP_TRANSPORTS: McpTransport[] = ["stdio", "http", "sse"];
export const TEAM_COORDINATIONS: TeamCoordination[] = ["classic", "sequenced", "autonomous"];

export function parseModel(value: unknown): Model {
  return MODELS.includes(value as Model) ? (value as Model) : "sonnet";
}

export function parseEffort(value: unknown): Effort {
  return EFFORTS.includes(value as Effort) ? (value as Effort) : "medium";
}

export function parseTransport(value: unknown): McpTransport {
  return MCP_TRANSPORTS.includes(value as McpTransport) ? (value as McpTransport) : "stdio";
}

export function parseCoordination(value: unknown): TeamCoordination {
  return TEAM_COORDINATIONS.includes(value as TeamCoordination) ? (value as TeamCoordination) : "classic";
}

export function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function parseStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

// Shared types for the orchestration server — a headless, multi-board
// Kanban store with an MCP endpoint for coordinating multiple Claude Code
// sessions. See agent-kanban-orchestration-plan-v2-1.md for the full design.

export interface Board {
  id: string; // ULID
  slug: string; // unique, URL-safe handle
  title: string;
  description?: string;
  leaseMs?: number; // per-board override of claim lease duration
  heartbeatMs?: number; // per-board override of liveness threshold
  createdAt: number;
  archivedAt?: number; // archived boards are read-only and hidden from lists
}

export type CardStatus = "backlog" | "ready" | "in_progress" | "review" | "done" | "blocked";

export interface Card {
  id: string; // ULID
  boardId: string;
  title: string;
  description: string;
  status: CardStatus;
  priority: number; // lower = more urgent
  dependsOn: string[]; // card IDs that must be "done" before this is claimable
  fileScope: string[]; // glob paths this card owns, e.g. ["src/api/**"]
  branch?: string;
  acceptance: string[]; // done-when criteria
  assignee?: string; // agent ID currently holding the claim
  leaseExpiresAt?: number; // epoch ms; claim is void after this
  result?: string; // completion summary written by the agent
  createdAt: number;
  updatedAt: number;
}

export type AgentStatus = "idle" | "working" | "blocked" | "offline";

export interface Agent {
  id: string; // ULID, minted at registration
  boardId: string;
  name: string;
  role: string;
  status: AgentStatus;
  currentCardId?: string;
  lastHeartbeatAt: number;
  registeredAt: number;
  meta?: Record<string, string>;
}

export interface Message {
  id: string; // ULID (doubles as time ordering)
  boardId: string;
  from: string; // agent ID
  to: string; // agent ID or "*" for broadcast
  cardId?: string;
  body: string;
  createdAt: number;
}

export type EventType =
  | "card.created"
  | "card.claimed"
  | "card.moved"
  | "card.progress"
  | "card.completed"
  | "card.released"
  | "card.lease_expired"
  | "agent.registered"
  | "agent.heartbeat_missed"
  | "agent.offline"
  | "message.sent";

export interface BoardEvent {
  id: string; // ULID — cursor-friendly
  boardId: string;
  type: EventType;
  actor: string; // agent ID or "system"
  cardId?: string;
  detail?: string;
  createdAt: number;
}

export const DEFAULT_LEASE_MS = 10 * 60_000; // 10 minutes
export const DEFAULT_HEARTBEAT_MS = 60_000; // 60 seconds

import type { FeedEvent, Session, Snapshot } from "../../src/switchboard/types.ts";

export const state: Snapshot = {
  sessions: [],
  teams: [],
  events: [],
  grants: [],
  transcripts: {},
  mcpConfigs: [],
};

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function findSession(id: string): Session {
  const session = state.sessions.find((s) => s.id === id);
  if (!session) throw new Error(`Unknown session id: ${id}`);
  return session;
}

export function findEvent(id: string): FeedEvent {
  const event = state.events.find((e) => e.id === id);
  if (!event) throw new Error(`Unknown event id: ${id}`);
  return event;
}

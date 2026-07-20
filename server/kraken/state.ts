import type { FeedEvent, Session, Snapshot } from "../../src/kraken/types.ts";

export const state: Snapshot = {
  sessions: [],
  teams: [],
  events: [],
  grants: [],
  transcripts: {},
  mcpConfigs: [],
  skills: [],
  subagents: [],
  schedules: [],
  catchUpMissedSchedules: false,
  apiKeyConfigured: false,
  apiKeyTail: null,
  geminiKeyConfigured: false,
  geminiKeyTail: null,
  defaultDirectory: null,
};

let counter = 0;
// The counter keeps ids ordered and readable; the random suffix keeps them
// unguessable — ids gate real actions (POST /events/:id/approve), so a
// predictable "e-42" would let anything that can reach the API resolve an
// approval it never saw. 32 bits of entropy is plenty at that call rate.
export function nextId(prefix: string): string {
  counter += 1;
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${counter}-${suffix}`;
}

// state-store.ts persists the counter alongside the records so ids minted
// after a restart can never collide with restored ones.
export function idCounter(): number {
  return counter;
}

export function setIdCounter(value: number): void {
  counter = value;
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

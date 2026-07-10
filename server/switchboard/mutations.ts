import type { EventResolution, FeedEvent, Grant, McpConfig, Schedule, Session, Team, TranscriptMessage } from "../../src/switchboard/types.ts";
import { findEvent, findSession, nextId, state } from "./state.ts";
import { publish } from "./bus.ts";

export function appendEvent(event: FeedEvent): void {
  state.events = [event, ...state.events];
  publish("feed-event", event);
}

type NewFeedEvent = Omit<FeedEvent, "id" | "ts" | "resolved"> & Partial<Pick<FeedEvent, "resolved">>;

export function pushFeedEvent(partial: NewFeedEvent): FeedEvent {
  const event: FeedEvent = { id: nextId("e"), ts: Date.now(), resolved: null, ...partial };
  appendEvent(event);
  return event;
}

export function pushSessionPatch(sid: string, patch: Partial<Session>): void {
  Object.assign(findSession(sid), patch);
  publish("session-patch", { id: sid, patch });
}

export function resolveEvent(id: string, resolution: EventResolution): void {
  const event = findEvent(id);
  event.resolved = resolution;
  publish("event-patch", { id, patch: { resolved: resolution } });
}

export function addGrant(sid: string, pattern: string): Grant {
  const grant: Grant = { id: nextId("g"), sid, pattern, grantedAt: Date.now() };
  state.grants = [...state.grants, grant];
  publish("grant-added", grant);
  return grant;
}

export function pushTranscriptMessage(sid: string, message: TranscriptMessage): void {
  state.transcripts[sid] = [...(state.transcripts[sid] ?? []), message];
  publish("transcript-message", { sid, message });
}

export function pushTeamsReplace(teams: Team[]): void {
  state.teams = teams;
  publish("teams-replaced", teams);
}

export function removeGrant(id: string): void {
  state.grants = state.grants.filter((g) => g.id !== id);
  publish("grant-revoked", { id });
}

export function restoreGrant(grant: Grant): void {
  state.grants = [...state.grants, grant];
  publish("grant-added", grant);
}

export function pushSessionAdd(session: Session): void {
  state.sessions = [...state.sessions, session];
  publish("session-added", session);
}

export function pushSessionRemove(id: string): void {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  publish("session-removed", { id });
}

export function pushMcpConfigsReplace(configs: McpConfig[]): void {
  state.mcpConfigs = configs;
  publish("mcp-configs-replaced", configs);
}

export function pushSchedulesReplace(schedules: Schedule[]): void {
  state.schedules = schedules;
  publish("schedules-replaced", schedules);
}

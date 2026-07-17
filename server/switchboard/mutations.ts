import type { EventResolution, FeedEvent, Grant, McpConfig, Schedule, Session, Skill, SubagentPreset, Team, TranscriptMessage } from "../../src/switchboard/types.ts";
import { findEvent, findSession, nextId, state } from "./state.ts";
import { publish } from "./bus.ts";
import { persistStateSoon } from "./state-store.ts";

// In-memory cap (larger than the 1000 persisted): without one, a busy
// week-long run grows the feed — and every /snapshot payload — forever.
const MAX_FEED_EVENTS = 2000;

export function appendEvent(event: FeedEvent): void {
  state.events = [event, ...state.events].slice(0, MAX_FEED_EVENTS);
  publish("feed-event", event);
  persistStateSoon();
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
  persistStateSoon();
}

export function resolveEvent(id: string, resolution: EventResolution): void {
  const event = findEvent(id);
  event.resolved = resolution;
  publish("event-patch", { id, patch: { resolved: resolution } });
  persistStateSoon();
}

export function addGrant(sid: string, pattern: string): Grant {
  const grant: Grant = { id: nextId("g"), sid, pattern, grantedAt: Date.now() };
  state.grants = [...state.grants, grant];
  publish("grant-added", grant);
  persistStateSoon();
  return grant;
}

// Deleting a session must drop its transcript too — before this existed,
// every deleted session's transcript lived (and persisted) forever.
export function pushTranscriptRemove(sid: string): void {
  if (!(sid in state.transcripts)) return;
  const { [sid]: _removed, ...rest } = state.transcripts;
  state.transcripts = rest;
  publish("transcript-removed", { sid });
  persistStateSoon();
}

export function pushTranscriptMessage(sid: string, message: TranscriptMessage): void {
  state.transcripts[sid] = [...(state.transcripts[sid] ?? []), message];
  publish("transcript-message", { sid, message });
  persistStateSoon();
}

export function pushTeamsReplace(teams: Team[]): void {
  state.teams = teams;
  publish("teams-replaced", teams);
  persistStateSoon();
}

export function removeGrant(id: string): void {
  state.grants = state.grants.filter((g) => g.id !== id);
  publish("grant-revoked", { id });
  persistStateSoon();
}

export function restoreGrant(grant: Grant): void {
  state.grants = [...state.grants, grant];
  publish("grant-added", grant);
  persistStateSoon();
}

export function pushSessionAdd(session: Session): void {
  state.sessions = [...state.sessions, session];
  publish("session-added", session);
  persistStateSoon();
}

export function pushSessionRemove(id: string): void {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  publish("session-removed", { id });
  persistStateSoon();
}

export function pushMcpConfigsReplace(configs: McpConfig[]): void {
  state.mcpConfigs = configs;
  publish("mcp-configs-replaced", configs);
  persistStateSoon();
}

export function pushSkillsReplace(skills: Skill[]): void {
  state.skills = skills;
  publish("skills-replaced", skills);
  persistStateSoon();
}

export function pushSubagentsReplace(subagents: SubagentPreset[]): void {
  state.subagents = subagents;
  publish("subagents-replaced", subagents);
  persistStateSoon();
}

export function pushSchedulesReplace(schedules: Schedule[]): void {
  state.schedules = schedules;
  publish("schedules-replaced", schedules);
}

export function pushCatchUpMissedSchedulesReplace(value: boolean): void {
  state.catchUpMissedSchedules = value;
  publish("catch-up-missed-schedules-replaced", value);
}

// Status only — the key itself lives in settings-store/Deno.env and is
// never pushed through the bus or persisted by state-store.
export function pushApiKeyStatusReplace(configured: boolean, tail: string | null): void {
  state.apiKeyConfigured = configured;
  state.apiKeyTail = tail;
  publish("api-key-status-replaced", { configured, tail });
}

export function pushGeminiKeyStatusReplace(configured: boolean, tail: string | null): void {
  state.geminiKeyConfigured = configured;
  state.geminiKeyTail = tail;
  publish("gemini-key-status-replaced", { configured, tail });
}

export function pushDefaultDirectoryReplace(value: string | null): void {
  state.defaultDirectory = value;
  publish("default-directory-replaced", value);
}

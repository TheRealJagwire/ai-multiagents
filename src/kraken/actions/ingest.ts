// Everything the SSE stream (and the snapshot fetch) writes into the store —
// the receiving half of the frontend's state loop. Nothing here talks to the
// network except handleConnectionChange's re-fetch.

import * as api from "../api.ts";
import {
  apiKeyConfigured,
  apiKeyTail,
  catchUpMissedSchedules,
  connected,
  defaultDirectory,
  deleteSessionConfirm,
  events,
  geminiKeyConfigured,
  geminiKeyTail,
  grants,
  mcpConfigs,
  schedules,
  selectedSessionId,
  sessions,
  skills,
  subagents,
  teams,
  transcripts,
} from "../store.ts";
import type { FeedEvent, Grant, McpConfig, Schedule, Session, Skill, Snapshot, SubagentPreset, Team, TranscriptMessage } from "../types.ts";
import { closeSession } from "./sessions.ts";

export function ingestSnapshot(snapshot: Snapshot): void {
  sessions.value = snapshot.sessions;
  teams.value = snapshot.teams;
  events.value = [...snapshot.events].sort((a, b) => b.ts - a.ts);
  grants.value = snapshot.grants;
  transcripts.value = snapshot.transcripts;
  mcpConfigs.value = snapshot.mcpConfigs;
  skills.value = snapshot.skills;
  subagents.value = snapshot.subagents;
  schedules.value = snapshot.schedules;
  catchUpMissedSchedules.value = snapshot.catchUpMissedSchedules;
  apiKeyConfigured.value = snapshot.apiKeyConfigured;
  apiKeyTail.value = snapshot.apiKeyTail;
  geminiKeyConfigured.value = snapshot.geminiKeyConfigured;
  geminiKeyTail.value = snapshot.geminiKeyTail;
  defaultDirectory.value = snapshot.defaultDirectory;
}

// The snapshot is otherwise only ever fetched once at mount — after a real
// reconnect (not the initial "open" every EventSource fires on first
// connect), the SSE stream resumes on top of whatever state we last had,
// which is stale if the backend restarted meanwhile. Re-fetching here means
// a reconnect always lands on ground truth instead of silently drifting.
export async function handleConnectionChange(isConnected: boolean): Promise<void> {
  const wasDisconnected = !connected.value;
  connected.value = isConnected;
  if (isConnected && wasDisconnected) {
    ingestSnapshot(await api.fetchSnapshot());
  }
}

export function replaceMcpConfigs(configs: McpConfig[]): void {
  mcpConfigs.value = configs;
}

export function replaceSkills(next: Skill[]): void {
  skills.value = next;
}

export function replaceSubagents(next: SubagentPreset[]): void {
  subagents.value = next;
}

export function replaceSchedules(nextSchedules: Schedule[]): void {
  schedules.value = nextSchedules;
}

export function replaceCatchUpMissedSchedules(value: boolean): void {
  catchUpMissedSchedules.value = value;
}

export function replaceApiKeyStatus(configured: boolean, tail: string | null): void {
  apiKeyConfigured.value = configured;
  apiKeyTail.value = tail;
}

export function replaceGeminiKeyStatus(configured: boolean, tail: string | null): void {
  geminiKeyConfigured.value = configured;
  geminiKeyTail.value = tail;
}

export function replaceDefaultDirectory(value: string | null): void {
  defaultDirectory.value = value;
}

// Mirrors the backend's in-memory cap so a long-lived tab doesn't outgrow
// the server's own bound.
const MAX_FEED_EVENTS = 2000;

export function ingestFeedEvent(event: FeedEvent): void {
  events.value = [event, ...events.value].slice(0, MAX_FEED_EVENTS);
}

export function patchSession(id: string, patch: Partial<Session>): void {
  sessions.value = sessions.value.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

export function patchEvent(id: string, patch: Partial<FeedEvent>): void {
  events.value = events.value.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

export function addGrant(grant: Grant): void {
  grants.value = [...grants.value, grant];
}

export function removeGrant(id: string): void {
  grants.value = grants.value.filter((g) => g.id !== id);
}

export function ingestTranscriptMessage(sid: string, message: TranscriptMessage): void {
  transcripts.value = { ...transcripts.value, [sid]: [...(transcripts.value[sid] ?? []), message] };
}

export function removeTranscriptLocally(sid: string): void {
  const { [sid]: _removed, ...rest } = transcripts.value;
  transcripts.value = rest;
}

export function replaceTeams(nextTeams: Team[]): void {
  teams.value = nextTeams;
}

export function addSession(session: Session): void {
  sessions.value = [...sessions.value, session];
}

export function removeSessionLocally(id: string): void {
  sessions.value = sessions.value.filter((s) => s.id !== id);
  if (selectedSessionId.value === id) closeSession();
  if (deleteSessionConfirm.value === id) deleteSessionConfirm.value = null;
}

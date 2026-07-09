import { computed, signal } from "@preact/signals";
import type { Effort, FeedEvent, Grant, Model, Session, Team, TranscriptMessage } from "./types.ts";

export type SpawnMode = "solo" | "existing" | "new";

export interface DraftMember {
  task: string;
  model: Model;
  effort: Effort;
}

export type ActivityFilter = "all" | "unread" | "artifacts" | "errors";
export type Tab = "feed" | "sessions" | "teams";

export interface RailGroup {
  id: string | null; // null = independent
  name: string;
  sessions: Session[];
}

// Raw collections
export const sessions = signal<Session[]>([]);
export const teams = signal<Team[]>([]);
export const events = signal<FeedEvent[]>([]); // newest first
export const grants = signal<Grant[]>([]);
export const transcripts = signal<Record<string, TranscriptMessage[]>>({});

// UI state
export const activeTab = signal<Tab>("feed");
export const lastSeen = signal<number>(Date.now());
export const pinnedShowAll = signal(false);
export const activeFilter = signal<ActivityFilter>("all");
export const searchQuery = signal("");
export const sessionFilter = signal<string | null>(null);
export const digestDismissed = signal(false);
export const awaySince = signal<number | null>(null);
export const selectedSessionId = signal<string | null>(null);
export const confirmStop = signal(false);
export const chatText = signal("");
export const expandedMemberId = signal<string | null>(null);
export const moveConfirm = signal<{ sid: string; target: string | null } | null>(null);
export const toast = signal<{ label: string; undo?: () => void } | null>(null);
export const focusedPinnedIndex = signal(0);
export const feedWindowSize = signal(150);
export const reviewOpen = signal<string | null>(null);
export const revComment = signal("");
export const grantsOpen = signal(false);
export const modalOpen = signal(false);
export const modalMode = signal<SpawnMode>("solo");
export const teamName = signal("");
export const promptText = signal("");
export const targetTeamId = signal<string | null>(null);
export const memberModel = signal<Model>("sonnet");
export const memberEffort = signal<Effort>("medium");
export const draftMembers = signal<DraftMember[]>([]);
export const spawnDir = signal("");
export const spawnBaseRef = signal("HEAD");

// Derived
export const sessionsById = computed(() => new Map(sessions.value.map((s) => [s.id, s])));
export const eventsById = computed(() => new Map(events.value.map((e) => [e.id, e])));

export const selectedSession = computed<Session | null>(() =>
  selectedSessionId.value ? sessionsById.value.get(selectedSessionId.value) ?? null : null
);

export const selectedTranscript = computed<TranscriptMessage[]>(() =>
  selectedSessionId.value ? transcripts.value[selectedSessionId.value] ?? [] : []
);

export const unresolvedDecisions = computed<FeedEvent[]>(() =>
  events.value.filter((e) =>
    (e.kind === "approval" || e.kind === "error" || e.kind === "review") && e.resolved === null
  )
);

export const pinnedSorted = computed<FeedEvent[]>(() =>
  [...unresolvedDecisions.value].sort((a, b) => a.ts - b.ts)
);

export const unreadCount = computed<number>(() =>
  events.value.filter((e) => e.ts > lastSeen.value && !e.own).length
);

export const filteredStream = computed<FeedEvent[]>(() => {
  let list = events.value;

  if (sessionFilter.value) {
    list = list.filter((e) => e.sid === sessionFilter.value);
  }

  if (activeFilter.value === "unread") {
    list = list.filter((e) => e.ts > lastSeen.value && !e.own);
  } else if (activeFilter.value === "artifacts") {
    list = list.filter((e) => e.kind === "artifact" || e.kind === "review");
  } else if (activeFilter.value === "errors") {
    list = list.filter((e) => e.kind === "error");
  }

  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    list = list.filter((e) => {
      const session = sessionsById.value.get(e.sid);
      const haystack = `${e.verb} ${e.artName ?? ""} ${session?.name ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  return list;
});

export const railGroups = computed<RailGroup[]>(() => {
  const byLeadFirst = (a: Session, b: Session) => Number(b.lead) - Number(a.lead);

  const groups: RailGroup[] = teams.value.map((t) => ({ id: t.id, name: t.name, sessions: [] }));
  const independent: RailGroup = { id: null, name: "Independent", sessions: [] };

  for (const s of sessions.value) {
    if (s.teamId === null) {
      independent.sessions.push(s);
      continue;
    }
    const group = groups.find((g) => g.id === s.teamId);
    group?.sessions.push(s);
  }

  for (const g of groups) g.sessions.sort(byLeadFirst);
  independent.sessions.sort(byLeadFirst);

  return [...groups, independent];
});

export const statusSummary = computed<string>(() => {
  const runningCount = sessions.value.filter((s) => s.status === "running").length;
  const needsYouCount = unresolvedDecisions.value.length;
  return `${runningCount} running · ${needsYouCount} need you`;
});

import { computed, signal } from "@preact/signals";
import type {
  Effort,
  EventKind,
  FeedEvent,
  Grant,
  McpConfig,
  McpTransport,
  Model,
  RecurrenceUnit,
  Schedule,
  Session,
  Team,
  TranscriptMessage,
} from "./types.ts";

export type SpawnMode = "solo" | "existing" | "new";

export interface DraftMember {
  task: string;
  model: Model;
  effort: Effort;
}

export type ActivityFilter = "all" | "unread";
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
export const mcpConfigs = signal<McpConfig[]>([]);
export const schedules = signal<Schedule[]>([]);
export const catchUpMissedSchedules = signal(false);
// Status only — the key itself never reaches the frontend.
export const apiKeyConfigured = signal(false);
export const apiKeyTail = signal<string | null>(null);

// UI state
export const activeTab = signal<Tab>("feed");
// Ticked every 30s from App.tsx so "2m ago"/elapsed timers actually move —
// without a shared clock signal they only recompute whenever some unrelated
// state change happens to trigger a re-render, then jump.
export const now = signal<number>(Date.now());
export const lastSeen = signal<number>(Date.now());
export const pinnedShowAll = signal(false);
export const activeFilter = signal<ActivityFilter>("all");

// Multi-select kind filter: empty = no filtering (show every kind); a
// non-empty selection shows only those kinds. Selection survives reloads —
// a filter you set up is a working context, not a per-visit whim.
export const ALL_EVENT_KINDS: EventKind[] = ["info", "message", "artifact", "approval", "error", "review"];
export const KIND_FILTER_KEY = "switchboard.kindFilter";

function loadKindFilter(): EventKind[] {
  try {
    const raw = localStorage.getItem(KIND_FILTER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is EventKind => (ALL_EVENT_KINDS as string[]).includes(k)) : [];
  } catch {
    return [];
  }
}

export const kindFilter = signal<EventKind[]>(loadKindFilter());
export const searchQuery = signal("");
export const sessionFilter = signal<string | null>(null);
export const digestDismissed = signal(false);
export const awaySince = signal<number | null>(null);
export const selectedSessionId = signal<string | null>(null);
export const confirmStop = signal(false);
// Keyed by session id so switching between sessions never wipes a
// half-typed message — each session keeps its own draft.
export const chatDrafts = signal<Record<string, string>>({});
export const expandedMemberId = signal<string | null>(null);
export const moveConfirm = signal<{ sid: string; target: string | null } | null>(null);
export const deleteSessionConfirm = signal<string | null>(null);
export const deleteTeamConfirm = signal<string | null>(null);
export const startWorkersConfirm = signal<string | null>(null);
export const connected = signal(true);
export interface Toast {
  id: number;
  label: string;
  undo?: () => void;
}
// A stack, not a single slot — rapid actions across sessions (approve here,
// deny there) used to overwrite each other's toast, silently discarding
// earlier undo affordances along with it.
export const toasts = signal<Toast[]>([]);
// Focus tracked by event id, not list position — a positional index goes
// stale the instant another agent's approval resolves and the pinned list
// reshuffles out from under it, letting y/n fire on the wrong card.
export const focusedPinnedId = signal<string | null>(null);
export const keyboardHelpOpen = signal(false);
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
export const spawnCreateNew = signal(false);
export const spawnNoWorktree = signal(false);
export const spawnMcpConfigIds = signal<string[]>([]);
// datetime-local input value ("" until the user picks a time) — parsed to
// an epoch ms with `new Date(value).getTime()` at submit time, which
// interprets it in the browser's local timezone, matching the "local time"
// the user actually picked.
export const spawnScheduleEnabled = signal(false);
export const spawnScheduleAt = signal("");
// "none" = one-shot (the common case). "interval" repeats every N
// minutes/hours/days from the picked time; "weekly" repeats on the picked
// local days of week at the picked time's hour:minute.
export type RecurrenceMode = "none" | "interval" | "weekly";
export const spawnRecurrenceMode = signal<RecurrenceMode>("none");
export const spawnRecurrenceEvery = signal(1);
export const spawnRecurrenceUnit = signal<RecurrenceUnit>("days");
export const spawnRecurrenceDays = signal<number[]>([]); // 0=Sun..6=Sat
export const dirSuggestions = signal<string[]>([]);

export const RECENT_DIRS_KEY = "switchboard.recentDirs";
export const MAX_RECENT_DIRS = 6;

function loadRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

// Typing an absolute repo path from memory is the single highest-friction
// step in spawning — remembering what's been used before (and offering it
// as one-click chips, see SpawnModal.tsx) cuts that down to a click.
export const recentDirs = signal<string[]>(loadRecentDirs());
export const spawnLeadPlans = signal(false);
export const spawnAutonomousLead = signal(false);
export const spawnError = signal<string | null>(null);

export type ThemeMode = "system" | "light" | "dark";
export const THEME_KEY = "switchboard.theme";

function loadTheme(): ThemeMode {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

export const theme = signal<ThemeMode>(loadTheme());
export const spawnSubmitting = signal(false);

// MCP config library modal
export const mcpFormName = signal("");
export const mcpFormTransport = signal<McpTransport>("stdio");
export const mcpFormCommand = signal("");
export const mcpFormArgsText = signal("");
export const mcpFormEnvText = signal("");
export const mcpFormUrl = signal("");
export const mcpFormHeadersText = signal("");
// Non-null while editing an existing config (its id) — submitMcpConfig
// branches add-vs-update off this rather than taking a separate parameter.
export const mcpEditingId = signal<string | null>(null);
export const mcpDeleteConfirm = signal<string | null>(null);

// Settings modal (gear in the TopBar) — currently just the Anthropic API
// key. The draft is write-only: it's never prefilled from the server.
export const settingsModalOpen = signal(false);
export const apiKeyDraft = signal("");
export const apiKeySaving = signal(false);
export const apiKeyError = signal<string | null>(null);

// Scheduled items modal — lists what's pending plus a small form to
// schedule a message to an already-running session (scheduling a new
// session/team happens from SpawnModal instead, since it needs that form's
// full field set).
export const scheduledModalOpen = signal(false);
export const scheduleMsgSessionId = signal<string | null>(null);
export const scheduleMsgText = signal("");
export const scheduleMsgAt = signal("");
export const scheduleDeleteConfirm = signal<string | null>(null);
export const scheduleError = signal<string | null>(null);

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
  }

  if (kindFilter.value.length > 0) {
    const selected = new Set(kindFilter.value);
    list = list.filter((e) => selected.has(e.kind));
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

export const runningCount = computed<number>(() => sessions.value.filter((s) => s.status === "running").length);
export const needsYouCount = computed<number>(() => unresolvedDecisions.value.length);

export const statusSummary = computed<string>(() => `${runningCount.value} running · ${needsYouCount.value} need you`);

// A pending schedule time only applies to "new"/"solo" modes (see
// SpawnModal) — checked separately so both branches below can share it.
const scheduleTimeError = computed<string | null>(() => {
  if (!spawnScheduleEnabled.value) return null;
  if (!spawnScheduleAt.value) return "Pick a time to schedule for";
  const runAt = new Date(spawnScheduleAt.value).getTime();
  if (!Number.isFinite(runAt) || runAt <= Date.now()) return "Scheduled time must be in the future";
  if (spawnRecurrenceMode.value === "interval" && (!Number.isInteger(spawnRecurrenceEvery.value) || spawnRecurrenceEvery.value < 1)) {
    return "Repeat interval must be at least 1";
  }
  if (spawnRecurrenceMode.value === "weekly" && spawnRecurrenceDays.value.length === 0) {
    return "Pick at least one day to repeat on";
  }
  return null;
});

// Client-side mirror of what the server would reject anyway — catching it
// here means the failure shows up as disabled-submit-button-with-a-reason
// instead of a spawned session that immediately errors out.
export const spawnValidationError = computed<string | null>(() => {
  const isAbsolute = (path: string) => path.trim().startsWith("/");

  if (modalMode.value === "new") {
    if (!teamName.value.trim()) return "Team name is required";
    if (!promptText.value.trim()) return "Team goal is required";
    if (!spawnDir.value.trim()) return "Directory is required";
    if (!isAbsolute(spawnDir.value)) return "Directory must be an absolute path (starting with /)";
    const relevantMembers = spawnLeadPlans.value ? draftMembers.value.slice(0, 1) : draftMembers.value;
    if (relevantMembers.some((m) => !m.task.trim())) return "Every member needs a task";
    return scheduleTimeError.value;
  }

  if (modalMode.value === "existing") {
    if (!promptText.value.trim()) return "Task is required";
    if (!targetTeamId.value) return "Pick a team";
    return null;
  }

  if (!promptText.value.trim()) return "Task is required";
  if (!spawnDir.value.trim()) return "Directory is required";
  if (!isAbsolute(spawnDir.value)) return "Directory must be an absolute path (starting with /)";
  return scheduleTimeError.value;
});

export const pendingScheduleCount = computed<number>(() => schedules.value.filter((s) => s.status === "pending").length);

export const sortedSchedules = computed<Schedule[]>(() => {
  const pending = schedules.value.filter((s) => s.status === "pending").sort((a, b) => a.runAt - b.runAt);
  const rest = schedules.value.filter((s) => s.status !== "pending").sort((a, b) => b.runAt - a.runAt);
  return [...pending, ...rest];
});

export const scheduleMsgValidationError = computed<string | null>(() => {
  if (!scheduleMsgSessionId.value) return "Pick a session";
  if (!scheduleMsgText.value.trim()) return "Message text is required";
  if (!scheduleMsgAt.value) return "Pick a time to schedule for";
  const runAt = new Date(scheduleMsgAt.value).getTime();
  if (!Number.isFinite(runAt) || runAt <= Date.now()) return "Scheduled time must be in the future";
  return null;
});

export const mcpFormError = computed<string | null>(() => {
  if (!mcpFormName.value.trim()) return "Name is required";
  if (mcpFormTransport.value === "stdio") {
    if (!mcpFormCommand.value.trim()) return "Command is required for a stdio server";
  } else if (!mcpFormUrl.value.trim()) {
    return "URL is required for an http/sse server";
  }
  return null;
});

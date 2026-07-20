import { computed, signal, type Signal } from "@preact/signals";
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
  Skill,
  SubagentPreset,
  Team,
  TranscriptMessage,
} from "./types.ts";

export type SpawnMode = "solo" | "existing" | "new";

export interface DraftMember {
  task: string;
  model: Model;
  effort: Effort;
  name: string; // optional display name; "" = auto-generate
}

export type ActivityFilter = "all" | "unread";
// "sessions" was a third tab (read-only card grid of all sessions) — removed
// as redundant: the always-visible LeftRail and the Teams tab both list every
// session, and Teams is the one with management controls.
export type Tab = "feed" | "teams";

export interface RailGroup {
  id: string | null; // null = independent
  name: string;
  sessions: Session[];
}

// Every multi-field form lives in one object signal (spawnForm, mcpForm, …)
// rather than one signal per field — actions patch them via patchForm, and a
// new field is one interface line instead of a new export threaded through
// store/actions/components.
export function patchForm<T>(sig: Signal<T>, patch: Partial<T>): void {
  sig.value = { ...sig.value, ...patch };
}

// Raw collections
export const sessions = signal<Session[]>([]);
export const teams = signal<Team[]>([]);
export const events = signal<FeedEvent[]>([]); // newest first
export const grants = signal<Grant[]>([]);
export const transcripts = signal<Record<string, TranscriptMessage[]>>({});
export const mcpConfigs = signal<McpConfig[]>([]);
export const skills = signal<Skill[]>([]);
export const subagents = signal<SubagentPreset[]>([]);
export const schedules = signal<Schedule[]>([]);
export const catchUpMissedSchedules = signal(false);
// Status only — the keys themselves never reach the frontend.
export const apiKeyConfigured = signal(false);
export const apiKeyTail = signal<string | null>(null);
export const geminiKeyConfigured = signal(false);
export const geminiKeyTail = signal<string | null>(null);
// The spawn flow's opt-in default — not a secret, sent as-is.
export const defaultDirectory = signal<string | null>(null);

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
export const KIND_FILTER_KEY = "kraken.kindFilter";

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
// Non-null while the open session's name is being edited in SessionPane —
// holds the draft text; null = not renaming.
export const renameDraft = signal<string | null>(null);
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

// --- Spawn modal ---

// "none" = one-shot (the common case). "interval" repeats every N
// minutes/hours/days from the picked time; "weekly" repeats on the picked
// local days of week at the picked time's hour:minute.
export type RecurrenceMode = "none" | "interval" | "weekly";

export interface SpawnForm {
  teamName: string;
  promptText: string;
  targetTeamId: string | null;
  memberModel: Model;
  memberEffort: Effort;
  draftMembers: DraftMember[];
  dir: string;
  // Optional display name for solo/into-team spawns; "" = auto-generate.
  sessionName: string;
  // New-team form: optional orchestration board slug ("" = auto-detect).
  boardSlug: string;
  baseRef: string;
  createNew: boolean;
  noWorktree: boolean;
  // Opt into Settings › General's default directory instead of typing one.
  useDefaultDir: boolean;
  mcpConfigIds: string[];
  leadPlans: boolean;
  autonomousLead: boolean;
  // Starts the spawned session(s) in Claude's plan-mode: read-only until the
  // agent proposes a plan and you approve it to start executing (see
  // recordPlan / ExitPlanMode handling in agent-sessions.ts).
  planFirst: boolean;
  // datetime-local input value ("" until the user picks a time) — parsed to
  // an epoch ms with `new Date(value).getTime()` at submit time, which
  // interprets it in the browser's local timezone, matching the "local time"
  // the user actually picked.
  scheduleEnabled: boolean;
  scheduleAt: string;
  recurrenceMode: RecurrenceMode;
  recurrenceEvery: number;
  recurrenceUnit: RecurrenceUnit;
  recurrenceDays: number[]; // 0=Sun..6=Sat
}

export function initialSpawnForm(): SpawnForm {
  return {
    teamName: "",
    promptText: "",
    targetTeamId: null,
    memberModel: "sonnet",
    memberEffort: "medium",
    draftMembers: [],
    dir: "",
    sessionName: "",
    boardSlug: "",
    baseRef: "HEAD",
    createNew: false,
    noWorktree: false,
    useDefaultDir: false,
    mcpConfigIds: [],
    leadPlans: false,
    autonomousLead: false,
    planFirst: false,
    scheduleEnabled: false,
    scheduleAt: "",
    recurrenceMode: "none",
    recurrenceEvery: 1,
    recurrenceUnit: "days",
    recurrenceDays: [],
  };
}

export const modalOpen = signal(false);
export const modalMode = signal<SpawnMode>("solo");
export const spawnForm = signal<SpawnForm>(initialSpawnForm());
export const spawnError = signal<string | null>(null);
export const spawnSubmitting = signal(false);
export const dirSuggestions = signal<string[]>([]);

export const RECENT_DIRS_KEY = "kraken.recentDirs";
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

export type ThemeMode = "system" | "light" | "dark";
export const THEME_KEY = "kraken.theme";

function loadTheme(): ThemeMode {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

export const theme = signal<ThemeMode>(loadTheme());

// --- MCP config library (Settings › MCP servers) ---

export interface McpForm {
  name: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  // Non-null while editing an existing config (its id) — submitMcpConfig
  // branches add-vs-update off this rather than taking a separate parameter.
  editingId: string | null;
}

export function initialMcpForm(): McpForm {
  return { name: "", transport: "stdio", command: "", argsText: "", envText: "", url: "", headersText: "", editingId: null };
}

export const mcpForm = signal<McpForm>(initialMcpForm());
export const mcpDeleteConfirm = signal<string | null>(null);

// --- Skills library form (Settings › Skills) ---

export interface SkillForm {
  name: string;
  description: string;
  instructions: string;
  editingId: string | null;
}

export function initialSkillForm(): SkillForm {
  return { name: "", description: "", instructions: "", editingId: null };
}

export const skillForm = signal<SkillForm>(initialSkillForm());
export const skillDeleteConfirm = signal<string | null>(null);

// --- Subagent presets form (Settings › Subagents) ---

export interface SubagentForm {
  name: string;
  description: string;
  prompt: string;
  model: Model;
  effort: Effort;
  editingId: string | null;
}

export function initialSubagentForm(): SubagentForm {
  return { name: "", description: "", prompt: "", model: "sonnet", effort: "medium", editingId: null };
}

export const subagentForm = signal<SubagentForm>(initialSubagentForm());
export const subagentDeleteConfirm = signal<string | null>(null);

// --- Settings modal ---

// Opened per-section from the nav rail's individual buttons; null = closed.
export type SettingsSection = "general" | "mcp" | "skills" | "subagents";
export const settingsSection = signal<SettingsSection | null>(null);

// One draft/saving/error triple per saveable setting. The API-key drafts are
// write-only: never prefilled from the server.
export interface SettingsDraft {
  draft: string;
  saving: boolean;
  error: string | null;
}

export function initialSettingsDraft(): SettingsDraft {
  return { draft: "", saving: false, error: null };
}

export const apiKeyForm = signal<SettingsDraft>(initialSettingsDraft());
export const geminiKeyForm = signal<SettingsDraft>(initialSettingsDraft());
export const defaultDirForm = signal<SettingsDraft>(initialSettingsDraft());

// --- Scheduled items modal ---

// Lists what's pending plus a small form to schedule a message to an
// already-running session (scheduling a new session/team happens from
// SpawnModal instead, since it needs that form's full field set).
export interface ScheduleMsgForm {
  sessionId: string | null;
  text: string;
  at: string;
}

export function initialScheduleMsgForm(): ScheduleMsgForm {
  return { sessionId: null, text: "", at: "" };
}

export const scheduledModalOpen = signal(false);
export const scheduleMsgForm = signal<ScheduleMsgForm>(initialScheduleMsgForm());
export const scheduleDeleteConfirm = signal<string | null>(null);
export const scheduleError = signal<string | null>(null);

// Derived
export const sessionsById = computed(() => new Map(sessions.value.map((s) => [s.id, s])));
export const eventsById = computed(() => new Map(events.value.map((e) => [e.id, e])));

// Latest plan artifact per session — events are newest-first, so the first
// match seen per sid is its most recent plan. Backs the plan preview shown
// on a session's roster row (TeamMemberRow), outside the open SessionPane.
export const latestPlanBySession = computed(() => {
  const map = new Map<string, FeedEvent>();
  for (const e of events.value) {
    if (e.kind === "artifact" && e.artName === "Plan" && !map.has(e.sid)) map.set(e.sid, e);
  }
  return map;
});

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
  const form = spawnForm.value;
  if (!form.scheduleEnabled) return null;
  if (!form.scheduleAt) return "Pick a time to schedule for";
  const runAt = new Date(form.scheduleAt).getTime();
  if (!Number.isFinite(runAt) || runAt <= Date.now()) return "Scheduled time must be in the future";
  if (form.recurrenceMode === "interval" && (!Number.isInteger(form.recurrenceEvery) || form.recurrenceEvery < 1)) {
    return "Repeat interval must be at least 1";
  }
  if (form.recurrenceMode === "weekly" && form.recurrenceDays.length === 0) {
    return "Pick at least one day to repeat on";
  }
  return null;
});

// Client-side mirror of what the server would reject anyway — catching it
// here means the failure shows up as disabled-submit-button-with-a-reason
// instead of a spawned session that immediately errors out.
function directoryError(): string | null {
  const form = spawnForm.value;
  const isAbsolute = (path: string) => path.trim().startsWith("/");
  if (form.useDefaultDir) {
    if (!defaultDirectory.value) return "No default directory set — pick one in Settings › General, or enter one here";
    return null;
  }
  if (!form.dir.trim()) return "Directory is required";
  if (!isAbsolute(form.dir)) return "Directory must be an absolute path (starting with /)";
  return null;
}

export const spawnValidationError = computed<string | null>(() => {
  const form = spawnForm.value;
  if (modalMode.value === "new") {
    if (!form.teamName.trim()) return "Team name is required";
    if (!form.promptText.trim()) return "Team goal is required";
    const dirError = directoryError();
    if (dirError) return dirError;
    const relevantMembers = form.leadPlans ? form.draftMembers.slice(0, 1) : form.draftMembers;
    if (relevantMembers.some((m) => !m.task.trim())) return "Every member needs a task";
    return scheduleTimeError.value;
  }

  if (modalMode.value === "existing") {
    if (!form.promptText.trim()) return "Task is required";
    if (!form.targetTeamId) return "Pick a team";
    return null;
  }

  if (!form.promptText.trim()) return "Task is required";
  const dirError = directoryError();
  if (dirError) return dirError;
  return scheduleTimeError.value;
});

export const pendingScheduleCount = computed<number>(() => schedules.value.filter((s) => s.status === "pending").length);

export const sortedSchedules = computed<Schedule[]>(() => {
  const pending = schedules.value.filter((s) => s.status === "pending").sort((a, b) => a.runAt - b.runAt);
  const rest = schedules.value.filter((s) => s.status !== "pending").sort((a, b) => b.runAt - a.runAt);
  return [...pending, ...rest];
});

export const scheduleMsgValidationError = computed<string | null>(() => {
  const form = scheduleMsgForm.value;
  if (!form.sessionId) return "Pick a session";
  if (!form.text.trim()) return "Message text is required";
  if (!form.at) return "Pick a time to schedule for";
  const runAt = new Date(form.at).getTime();
  if (!Number.isFinite(runAt) || runAt <= Date.now()) return "Scheduled time must be in the future";
  return null;
});

export const mcpFormError = computed<string | null>(() => {
  const form = mcpForm.value;
  if (!form.name.trim()) return "Name is required";
  if (form.transport === "stdio") {
    if (!form.command.trim()) return "Command is required for a stdio server";
  } else if (!form.url.trim()) {
    return "URL is required for an http/sse server";
  }
  return null;
});

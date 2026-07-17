import { type Effort, type Model, type Provider, providerOf, type Recurrence, type SessionPhase, type SessionStatus } from "./types.ts";

// nowMs defaults to Date.now() for callers that don't care about live
// ticking; components that want the string to update on its own pass
// store.ts's `now` signal's value explicitly so the JSX read is what
// triggers the re-render.
export function relativeTime(ts: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - ts;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

const modelLabels: Record<Model, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
  "gemini-flash": "Gemini Flash",
  "gemini-pro": "Gemini Pro",
};
const effortLabels: Record<Effort, string> = { low: "Low", medium: "Med", high: "High" };

// The one model list every picker renders from — grouped by provider so the
// UI can show Claude and Gemini options distinctly, and so model-change
// chips can restrict to the session's own provider (a live session can't
// hop runtimes; see providerModels).
export const ALL_MODELS: Model[] = ["haiku", "sonnet", "opus", "gemini-flash", "gemini-pro"];

export function providerModels(provider: Provider): Model[] {
  return ALL_MODELS.filter((m) => providerOf(m) === provider);
}

export function modelLabel(model: Model): string {
  return modelLabels[model];
}

export function effortLabel(effort: Effort): string {
  return effortLabels[effort];
}

export function modelEffortLabel(model: Model, effort: Effort): string {
  return `${modelLabel(model)}·${effortLabel(effort)}`;
}

const statusLabels: Record<SessionStatus, string> = {
  running: "running",
  idle: "idle",
  waiting: "needs you",
  error: "blocked",
  paused: "paused",
  stopped: "stopped",
  done: "done",
};

export function statusLabel(status: SessionStatus): string {
  return statusLabels[status];
}

const phaseLabels: Record<SessionPhase, string> = {
  planning: "planning",
  executing: "executing",
  reviewing: "reviewing",
  gated: "gated on you",
  blocked: "blocked",
  stopped: "stopped by you",
  done: "done",
};

export function phaseLabel(phase: SessionPhase): string {
  return phaseLabels[phase];
}

export function elapsed(startedAt: number, nowMs: number = Date.now()): string {
  const minutes = Math.floor((nowMs - startedAt) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Rough relative per-step cost, only ever compared within one provider —
// the pickers never offer a cross-provider pending change, so ratios
// between the claude and gemini entries are never shown to anyone.
const modelRate: Record<Model, number> = { haiku: 1, sonnet: 3, opus: 15, "gemini-flash": 1, "gemini-pro": 8 };

export function costPhrase(from: Model, to: Model): string {
  const ratio = modelRate[to] / modelRate[from];
  if (ratio > 1) return ` · ≈${ratio % 1 ? ratio.toFixed(1) : ratio}× step cost`;
  return ` · ≈${Math.round((1 - ratio) * 100)}% cheaper per step`;
}

// Same shape as relativeTime but for a timestamp that may be in the future
// (a pending schedule) rather than always in the past.
export function formatWhen(ts: number, nowMs: number = Date.now()): string {
  const diffMs = ts - nowMs;
  if (diffMs <= 0) return relativeTime(ts, nowMs);
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "in <1m";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

export function formatLocalDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatRecurrence(recurrence: Recurrence | null): string | null {
  if (!recurrence) return null;
  if (recurrence.kind === "interval") {
    const unit = recurrence.every === 1 ? recurrence.unit.slice(0, -1) : recurrence.unit;
    return `every ${recurrence.every} ${unit}`;
  }
  const days = [...recurrence.daysOfWeek].sort().map((d) => DAY_NAMES[d]).join(", ");
  const time = new Date(0, 0, 1, recurrence.hour, recurrence.minute).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `weekly on ${days} at ${time}`;
}

// Turns arbitrary plan text (markdown prose, a numbered list, section
// headings, whatever the model or a SWITCHBOARD_TASKS.md task wrote) into a
// flat bulleted list: one non-blank line in, one bullet out, with any
// existing -/*/number/# marker stripped so it doesn't double up with the
// <li> bullet the caller renders.
export function planBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/^#{1,6}\s+/, ""));
}

export type ChipState = "current" | "pending" | "idle";

export function chipState(current: boolean, pending: boolean): ChipState {
  if (pending) return "pending";
  if (current) return "current";
  return "idle";
}

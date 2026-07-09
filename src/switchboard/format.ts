import type { Effort, Model, SessionPhase, SessionStatus } from "./types.ts";

export function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
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

const modelLabels: Record<Model, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };
const effortLabels: Record<Effort, string> = { low: "Low", medium: "Med", high: "High" };

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

export function elapsed(startedAt: number): string {
  const minutes = Math.floor((Date.now() - startedAt) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const modelRate: Record<Model, number> = { haiku: 1, sonnet: 3, opus: 15 };

export function costPhrase(from: Model, to: Model): string {
  const ratio = modelRate[to] / modelRate[from];
  if (ratio > 1) return ` · ≈${ratio % 1 ? ratio.toFixed(1) : ratio}× step cost`;
  return ` · ≈${Math.round((1 - ratio) * 100)}% cheaper per step`;
}

export type ChipState = "current" | "pending" | "idle";

export function chipState(current: boolean, pending: boolean): ChipState {
  if (pending) return "pending";
  if (current) return "current";
  return "idle";
}

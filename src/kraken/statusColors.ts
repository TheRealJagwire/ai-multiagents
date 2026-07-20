import type { SessionStatus } from "./types.ts";

export interface StatusColors {
  dot: string;
  bg: string;
  text: string;
}

const colors: Record<SessionStatus, StatusColors> = {
  running: { dot: "var(--sb-running-dot)", bg: "var(--sb-running-bg)", text: "var(--sb-running-text)" },
  idle: { dot: "var(--sb-idle-dot)", bg: "var(--sb-idle-bg)", text: "var(--sb-idle-text)" },
  waiting: { dot: "var(--sb-waiting-dot)", bg: "var(--sb-waiting-bg)", text: "var(--sb-waiting-text)" },
  error: { dot: "var(--sb-error-dot)", bg: "var(--sb-error-bg)", text: "var(--sb-error-text)" },
  paused: { dot: "var(--sb-paused-dot)", bg: "var(--sb-paused-bg)", text: "var(--sb-paused-text)" },
  stopped: { dot: "var(--sb-stopped-dot)", bg: "var(--sb-stopped-bg)", text: "var(--sb-stopped-text)" },
  done: { dot: "var(--sb-done-dot)", bg: "var(--sb-done-bg)", text: "var(--sb-done-text)" },
};

export function statusColor(status: SessionStatus): StatusColors {
  return colors[status];
}

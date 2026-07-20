import { type Toast, toasts } from "../store.ts";

const MAX_TOASTS = 3;
const INFO_TOAST_MS = 5000;
const UNDO_TOAST_MS = 9000; // undo-bearing toasts get longer to notice/act on

let nextToastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function removeToast(id: number): void {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function showToast(label: string, undo?: () => void): void {
  const id = nextToastId++;
  // Cap the stack rather than let rapid actions pile up indefinitely — drop
  // the oldest (and its timer) to make room, same as any bounded queue.
  if (toasts.value.length >= MAX_TOASTS) {
    removeToast(toasts.value[0].id);
  }
  toasts.value = [...toasts.value, { id, label, undo } satisfies Toast];
  toastTimers.set(id, setTimeout(() => removeToast(id), undo ? UNDO_TOAST_MS : INFO_TOAST_MS));
}

export function errMsg(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "request failed";
}

export function showErrorToast(label: string, err: unknown): void {
  showToast(`${label} — ${errMsg(err)}`);
}

export function dismissToast(id: number): void {
  removeToast(id);
}

export function undoToast(id: number): void {
  const undo = toasts.value.find((t) => t.id === id)?.undo;
  removeToast(id);
  undo?.();
}

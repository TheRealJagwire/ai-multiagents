const UNDO_WINDOW_MS = 7000;

const undoable = new Map<string, { fn: () => void; timer: ReturnType<typeof setTimeout> }>();

export function registerUndo(key: string, fn: () => void): void {
  const existing = undoable.get(key);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => undoable.delete(key), UNDO_WINDOW_MS);
  undoable.set(key, { fn, timer });
}

export function undoAction(key: string): void {
  const entry = undoable.get(key);
  if (!entry) return;

  clearTimeout(entry.timer);
  undoable.delete(key);
  entry.fn();
}

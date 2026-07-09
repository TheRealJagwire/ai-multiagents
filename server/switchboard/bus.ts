export interface BusMessage {
  event: string;
  data: unknown;
}

type Listener = (message: BusMessage) => void;

const listeners = new Set<Listener>();

export function publish(event: string, data: unknown): void {
  for (const listener of listeners) listener({ event, data });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

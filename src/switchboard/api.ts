import type { Effort, FeedEvent, Grant, McpConfig, Model, Session, Snapshot, Team, TranscriptMessage } from "./types.ts";

export async function fetchSnapshot(): Promise<Snapshot> {
  const res = await fetch("/api/switchboard/snapshot");
  return await res.json() as Snapshot;
}

export interface EventHandlers {
  onFeedEvent: (event: FeedEvent) => void;
  onSessionPatch: (id: string, patch: Partial<Session>) => void;
  onEventPatch: (id: string, patch: Partial<FeedEvent>) => void;
  onGrantAdded: (grant: Grant) => void;
  onGrantRevoked: (id: string) => void;
  onTranscriptMessage: (sid: string, message: TranscriptMessage) => void;
  onTeamsReplaced: (teams: Team[]) => void;
  onSessionAdded: (session: Session) => void;
  onSessionRemoved: (id: string) => void;
  onMcpConfigsReplaced: (configs: McpConfig[]) => void;
}

export function subscribeToEvents(handlers: EventHandlers): () => void {
  const source = new EventSource("/api/switchboard/events");

  source.addEventListener("feed-event", (message) => {
    const event = JSON.parse((message as MessageEvent).data) as FeedEvent;
    handlers.onFeedEvent(event);
  });

  source.addEventListener("session-patch", (message) => {
    const { id, patch } = JSON.parse((message as MessageEvent).data) as {
      id: string;
      patch: Partial<Session>;
    };
    handlers.onSessionPatch(id, patch);
  });

  source.addEventListener("event-patch", (message) => {
    const { id, patch } = JSON.parse((message as MessageEvent).data) as {
      id: string;
      patch: Partial<FeedEvent>;
    };
    handlers.onEventPatch(id, patch);
  });

  source.addEventListener("grant-added", (message) => {
    const grant = JSON.parse((message as MessageEvent).data) as Grant;
    handlers.onGrantAdded(grant);
  });

  source.addEventListener("grant-revoked", (message) => {
    const { id } = JSON.parse((message as MessageEvent).data) as { id: string };
    handlers.onGrantRevoked(id);
  });

  source.addEventListener("transcript-message", (message) => {
    const { sid, message: transcriptMessage } = JSON.parse((message as MessageEvent).data) as {
      sid: string;
      message: TranscriptMessage;
    };
    handlers.onTranscriptMessage(sid, transcriptMessage);
  });

  source.addEventListener("teams-replaced", (message) => {
    const teams = JSON.parse((message as MessageEvent).data) as Team[];
    handlers.onTeamsReplaced(teams);
  });

  source.addEventListener("session-added", (message) => {
    const session = JSON.parse((message as MessageEvent).data) as Session;
    handlers.onSessionAdded(session);
  });

  source.addEventListener("session-removed", (message) => {
    const { id } = JSON.parse((message as MessageEvent).data) as { id: string };
    handlers.onSessionRemoved(id);
  });

  source.addEventListener("mcp-configs-replaced", (message) => {
    const configs = JSON.parse((message as MessageEvent).data) as McpConfig[];
    handlers.onMcpConfigsReplaced(configs);
  });

  return () => source.close();
}

async function post(path: string, body?: Record<string, unknown>): Promise<void> {
  await fetch(`/api/switchboard${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function del(path: string): Promise<void> {
  await fetch(`/api/switchboard${path}`, { method: "DELETE" });
}

export function approveEvent(id: string, scope: "once" | "session"): Promise<void> {
  return post(`/events/${id}/approve`, { scope });
}

export function denyEvent(id: string): Promise<void> {
  return post(`/events/${id}/deny`);
}

export function retryEvent(id: string): Promise<void> {
  return post(`/events/${id}/retry`);
}

export function applyAltFix(id: string): Promise<void> {
  return post(`/events/${id}/alt-fix`);
}

export function togglePause(id: string): Promise<void> {
  return post(`/sessions/${id}/toggle-pause`);
}

export function stopSession(id: string): Promise<void> {
  return post(`/sessions/${id}/stop`);
}

export function sendMessage(id: string, text: string): Promise<void> {
  return post(`/sessions/${id}/messages`, { text });
}

export function queueModelChange(id: string, model: Model): Promise<void> {
  return post(`/sessions/${id}/queue-model`, { model });
}

export function queueEffortChange(id: string, effort: Effort): Promise<void> {
  return post(`/sessions/${id}/queue-effort`, { effort });
}

export function cancelPendingModel(id: string): Promise<void> {
  return post(`/sessions/${id}/cancel-pending`, { kind: "model" });
}

export function cancelPendingEffort(id: string): Promise<void> {
  return post(`/sessions/${id}/cancel-pending`, { kind: "effort" });
}

export function queueMove(id: string, target: string | null): Promise<void> {
  return post(`/sessions/${id}/queue-move`, { target });
}

export function cancelMove(id: string): Promise<void> {
  return post(`/sessions/${id}/cancel-move`);
}

export function makeLead(id: string): Promise<void> {
  return post(`/sessions/${id}/make-lead`);
}

export function deleteSession(id: string): Promise<void> {
  return del(`/sessions/${id}`);
}

export function deleteTeam(id: string): Promise<void> {
  return del(`/teams/${id}`);
}

export function startWorkers(id: string): Promise<void> {
  return post(`/teams/${id}/start-workers`);
}

export function approveArtifact(id: string): Promise<void> {
  return post(`/events/${id}/approve-artifact`);
}

export function requestChanges(id: string, note: string): Promise<void> {
  return post(`/events/${id}/request-changes`, { note });
}

export function revokeGrant(id: string): Promise<void> {
  return post(`/grants/${id}/revoke`);
}

export function spawnSession(body: Record<string, unknown>): Promise<void> {
  return post(`/sessions`, body);
}

export function addMcpConfig(body: Record<string, unknown>): Promise<void> {
  return post(`/mcp-configs`, body);
}

export function deleteMcpConfig(id: string): Promise<void> {
  return del(`/mcp-configs/${id}`);
}

export function undo(key: string): Promise<void> {
  return post(`/undo/${key}`);
}

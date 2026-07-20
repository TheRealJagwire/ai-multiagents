// Approvals, denials, artifact review, and grant revocation.
//
// Network-triggered resolution actions are thin pass-throughs so components
// only ever import from actions.ts, never api.ts directly. The resulting
// state change arrives back over the SSE stream (patchEvent/patchSession in
// ingest.ts), not from these calls' return value. Each awaits its API call
// before showing a toast: a success toast only ever appears once the server
// has actually confirmed it, and a failure surfaces as an error toast
// instead of silently doing nothing.

import * as api from "../api.ts";
import { eventsById, grants, grantsOpen, revComment, reviewOpen, sessionsById } from "../store.ts";
import { showErrorToast, showToast } from "./toasts.ts";

export async function approveEvent(id: string, scope: "once" | "session"): Promise<void> {
  const event = eventsById.value.get(id);
  const session = event ? sessionsById.value.get(event.sid) : undefined;
  try {
    await api.approveEvent(id, scope);
    if (session) showToast(`Approved ${session.short}`, () => api.undo(id));
  } catch (err) {
    showErrorToast(`Couldn't approve${session ? ` ${session.short}` : ""}`, err);
  }
}

export async function denyEvent(id: string): Promise<void> {
  const event = eventsById.value.get(id);
  const session = event ? sessionsById.value.get(event.sid) : undefined;
  try {
    await api.denyEvent(id);
    if (session) showToast(`Denied ${session.short}`, () => api.undo(id));
  } catch (err) {
    showErrorToast(`Couldn't deny${session ? ` ${session.short}` : ""}`, err);
  }
}

export async function retryEvent(id: string): Promise<void> {
  try {
    await api.retryEvent(id);
  } catch (err) {
    showErrorToast("Couldn't retry", err);
  }
}

export async function applyAltFix(id: string): Promise<void> {
  try {
    await api.applyAltFix(id);
  } catch (err) {
    showErrorToast("Couldn't apply fix", err);
  }
}

export function openReview(id: string): void {
  reviewOpen.value = id;
  revComment.value = "";
}

export function closeReview(): void {
  reviewOpen.value = null;
  revComment.value = "";
}

export function setRevComment(text: string): void {
  revComment.value = text;
}

export async function approveArtifact(id: string): Promise<void> {
  try {
    await api.approveArtifact(id);
    closeReview();
  } catch (err) {
    showErrorToast("Couldn't approve artifact", err);
  }
}

export async function requestChanges(id: string): Promise<void> {
  try {
    await api.requestChanges(id, revComment.value);
    closeReview();
  } catch (err) {
    showErrorToast("Couldn't request changes", err);
  }
}

export function toggleGrantsPopover(): void {
  grantsOpen.value = !grantsOpen.value;
}

export function closeGrantsPopover(): void {
  grantsOpen.value = false;
}

export async function revokeGrant(id: string): Promise<void> {
  const grant = grants.value.find((g) => g.id === id);
  try {
    await api.revokeGrant(id);
    if (grant) showToast(`Revoked ${grant.pattern}`, () => api.undo(id));
  } catch (err) {
    showErrorToast("Couldn't revoke grant", err);
  }
}

import { state } from "./state.ts";
import { pushFeedEvent, removeGrant, restoreGrant } from "./mutations.ts";
import { registerUndo } from "./undo.ts";

export function revokeGrant(id: string): void {
  const grant = state.grants.find((g) => g.id === id);
  if (!grant) return;

  removeGrant(id);
  pushFeedEvent({ sid: grant.sid, kind: "info", own: true, verb: `permission revoked: ${grant.pattern}` });

  registerUndo(id, () => {
    restoreGrant(grant);
    pushFeedEvent({ sid: grant.sid, kind: "info", own: true, verb: `revoke undone — ${grant.pattern} active again` });
  });
}

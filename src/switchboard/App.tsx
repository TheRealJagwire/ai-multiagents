import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import "./tokens.css";
import { fetchSnapshot, subscribeToEvents } from "./api.ts";
import {
  addGrant,
  addSession,
  approveEvent,
  closeGrantsPopover,
  closeReview,
  closeSession,
  closeSpawnModal,
  denyEvent,
  ingestFeedEvent,
  ingestSnapshot,
  ingestTranscriptMessage,
  patchEvent,
  patchSession,
  removeGrant,
  replaceTeams,
} from "./actions.ts";
import {
  activeTab,
  awaySince,
  digestDismissed,
  focusedPinnedIndex,
  grantsOpen,
  modalOpen,
  pinnedSorted,
  reviewOpen,
  selectedSessionId,
  unreadCount,
} from "./store.ts";
import { TopBar } from "./components/TopBar.tsx";
import { LeftRail } from "./components/LeftRail.tsx";
import { FeedView } from "./components/FeedView.tsx";
import { SessionsTab } from "./components/SessionsTab.tsx";
import { TeamsTab } from "./components/TeamsTab.tsx";
import { SessionPane } from "./components/SessionPane.tsx";
import { Toast } from "./components/Toast.tsx";
import { ReviewModal } from "./components/ReviewModal.tsx";
import { GrantsPopover } from "./components/GrantsPopover.tsx";
import { SpawnModal } from "./components/SpawnModal.tsx";

export function App() {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    fetchSnapshot().then((snapshot) => {
      ingestSnapshot(snapshot);
      unsubscribe = subscribeToEvents({
        onFeedEvent: ingestFeedEvent,
        onSessionPatch: patchSession,
        onEventPatch: patchEvent,
        onGrantAdded: addGrant,
        onGrantRevoked: (id) => removeGrant(id),
        onTranscriptMessage: ingestTranscriptMessage,
        onTeamsReplaced: replaceTeams,
        onSessionAdded: addSession,
      });
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) {
        awaySince.value = Date.now();
      } else if (awaySince.value !== null) {
        digestDismissed.value = false;
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (reviewOpen.value !== null) closeReview();
        else if (modalOpen.value) closeSpawnModal();
        else if (grantsOpen.value) closeGrantsPopover();
        else if (selectedSessionId.value !== null) closeSession();
        return;
      }

      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (isTyping) return;

      const pinned = pinnedSorted.value;
      if (e.key === "j") {
        focusedPinnedIndex.value = Math.min(focusedPinnedIndex.value + 1, Math.max(pinned.length - 1, 0));
      } else if (e.key === "k") {
        focusedPinnedIndex.value = Math.max(focusedPinnedIndex.value - 1, 0);
      } else if ((e.key === "y" || e.key === "n") && pinned.length > 0) {
        const event = pinned[Math.min(focusedPinnedIndex.value, pinned.length - 1)];
        if (event.kind === "approval") {
          if (e.key === "y") approveEvent(event.id, "once");
          else denyEvent(event.id);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() =>
    effect(() => {
      document.title = unreadCount.value > 0 ? `(${unreadCount.value}) Switchboard` : "Switchboard";
    }), []);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--sb-font-sans)",
        color: "var(--sb-text-1)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <TopBar />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <LeftRail />
        {activeTab.value === "feed" && <FeedView />}
        {activeTab.value === "sessions" && <SessionsTab />}
        {activeTab.value === "teams" && <TeamsTab />}
        <SessionPane />
      </div>
      <ReviewModal />
      <GrantsPopover />
      <SpawnModal />
      <Toast />
    </div>
  );
}

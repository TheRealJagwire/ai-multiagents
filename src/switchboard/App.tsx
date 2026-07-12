import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import "./tokens.css";
import { fetchSnapshot, subscribeToEvents } from "./api.ts";
import {
  addGrant,
  addSession,
  applyTheme,
  approveEvent,
  closeGrantsPopover,
  closeKeyboardHelp,
  closeMcpModal,
  closeReview,
  closeScheduledModal,
  closeSettingsModal,
  closeSession,
  closeSpawnModal,
  denyEvent,
  handleConnectionChange,
  ingestFeedEvent,
  ingestSnapshot,
  ingestTranscriptMessage,
  patchEvent,
  patchSession,
  removeGrant,
  removeSessionLocally,
  replaceApiKeyStatus,
  replaceCatchUpMissedSchedules,
  replaceMcpConfigs,
  replaceSchedules,
  replaceTeams,
  toggleKeyboardHelp,
} from "./actions.ts";
import {
  activeTab,
  awaySince,
  connected,
  digestDismissed,
  focusedPinnedId,
  grantsOpen,
  keyboardHelpOpen,
  mcpModalOpen,
  modalOpen,
  now,
  pinnedShowAll,
  pinnedSorted,
  reviewOpen,
  scheduledModalOpen,
  settingsModalOpen,
  selectedSessionId,
  theme,
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
import { McpConfigsModal } from "./components/McpConfigsModal.tsx";
import { ScheduledModal } from "./components/ScheduledModal.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { KeyboardHelp } from "./components/KeyboardHelp.tsx";

export function App() {
  useEffect(() => {
    applyTheme(theme.value);
  }, []);

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
        onSessionRemoved: removeSessionLocally,
        onMcpConfigsReplaced: replaceMcpConfigs,
        onSchedulesReplaced: replaceSchedules,
        onCatchUpMissedSchedulesReplaced: replaceCatchUpMissedSchedules,
        onApiKeyStatusReplaced: replaceApiKeyStatus,
        onConnectionChange: handleConnectionChange,
      });
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      now.value = Date.now();
    }, 30_000);
    return () => clearInterval(id);
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
        if (keyboardHelpOpen.value) closeKeyboardHelp();
        else if (reviewOpen.value !== null) closeReview();
        else if (modalOpen.value) closeSpawnModal();
        else if (mcpModalOpen.value) closeMcpModal();
        else if (settingsModalOpen.value) closeSettingsModal();
        else if (scheduledModalOpen.value) closeScheduledModal();
        else if (grantsOpen.value) closeGrantsPopover();
        else if (selectedSessionId.value !== null) closeSession();
        return;
      }

      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (isTyping) return;

      if (e.key === "?") {
        toggleKeyboardHelp();
        return;
      }

      const pinned = pinnedSorted.value;
      if (e.key === "j" || e.key === "k") {
        if (pinned.length === 0) return;
        const currentIndex = pinned.findIndex((ev) => ev.id === focusedPinnedId.value);
        const nextIndex = e.key === "j"
          ? Math.min(currentIndex + 1, pinned.length - 1)
          : Math.max(currentIndex - 1, 0);
        focusedPinnedId.value = pinned[nextIndex].id;
        // Focus moved past the always-visible first 2 — expand so the
        // focused card (and the y/n it's about to act on) is actually shown.
        if (nextIndex >= 2 && !pinnedShowAll.value) pinnedShowAll.value = true;
      } else if ((e.key === "y" || e.key === "Y" || e.key === "n") && pinned.length > 0) {
        const event = pinned.find((ev) => ev.id === focusedPinnedId.value) ?? pinned[0];
        if (event.kind === "approval") {
          if (e.key === "y") approveEvent(event.id, "once");
          else if (e.key === "Y") approveEvent(event.id, "session");
          else denyEvent(event.id);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Keeps focus pointed at a real, currently-pinned card — if the focused
  // event resolves (from elsewhere, e.g. clicking its button) and drops out
  // of the list, y/n must never silently act on whatever slid into its old
  // position.
  useEffect(() =>
    effect(() => {
      const pinned = pinnedSorted.value;
      if (focusedPinnedId.value && !pinned.some((ev) => ev.id === focusedPinnedId.value)) {
        focusedPinnedId.value = pinned[0]?.id ?? null;
      } else if (!focusedPinnedId.value && pinned.length > 0) {
        focusedPinnedId.value = pinned[0].id;
      }
    }), []);

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
      {!connected.value && (
        <div
          style={{
            padding: "6px 20px",
            background: "var(--sb-error-bg)",
            color: "var(--sb-error-text)",
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
            flex: "none",
          }}
        >
          Connection lost — reconnecting…
        </div>
      )}
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
      <McpConfigsModal />
      <ScheduledModal />
      <SettingsModal />
      <KeyboardHelp />
      <Toast />
    </div>
  );
}

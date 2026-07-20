// Feed filters, tabs, theme, and the small always-on UI toggles — local
// state only, nothing here touches the network.

import {
  activeFilter,
  type ActivityFilter,
  activeTab,
  digestDismissed,
  feedWindowSize,
  keyboardHelpOpen,
  KIND_FILTER_KEY,
  kindFilter,
  lastSeen,
  pinnedShowAll,
  searchQuery,
  sessionFilter,
  type Tab,
  theme,
  THEME_KEY,
  type ThemeMode,
} from "../store.ts";
import type { EventKind } from "../types.ts";

export function setFilter(filter: ActivityFilter): void {
  activeFilter.value = filter;
}

function saveKindFilter(kinds: EventKind[]): void {
  try {
    localStorage.setItem(KIND_FILTER_KEY, JSON.stringify(kinds));
  } catch {
    // Storage full/unavailable — the filter still works for this visit.
  }
}

export function toggleKindFilter(kind: EventKind): void {
  const current = kindFilter.value;
  const next = current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind];
  kindFilter.value = next;
  saveKindFilter(next);
}

export function clearKindFilter(): void {
  kindFilter.value = [];
  saveKindFilter([]);
}

export function setSearchQuery(query: string): void {
  searchQuery.value = query;
}

export function setSessionFilter(sid: string | null): void {
  sessionFilter.value = sid;
}

export function togglePinnedShowAll(): void {
  pinnedShowAll.value = !pinnedShowAll.value;
}

export function expandFeedWindow(): void {
  feedWindowSize.value += 150;
}

export function markCaughtUp(): void {
  lastSeen.value = Date.now();
  digestDismissed.value = true;
  if (activeFilter.value === "unread") activeFilter.value = "all";
}

export function dismissDigest(): void {
  digestDismissed.value = true;
}

export function setActiveTab(tab: Tab): void {
  activeTab.value = tab;
}

// Jumps to the Feed tab and expands the pinned block so every card that
// needs a decision is actually visible, not just the first two.
export function goToPinned(): void {
  activeTab.value = "feed";
  pinnedShowAll.value = true;
}

export function applyTheme(mode: ThemeMode): void {
  if (mode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
}

export function setTheme(mode: ThemeMode): void {
  theme.value = mode;
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
}

export function toggleKeyboardHelp(): void {
  keyboardHelpOpen.value = !keyboardHelpOpen.value;
}

export function closeKeyboardHelp(): void {
  keyboardHelpOpen.value = false;
}

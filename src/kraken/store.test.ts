import { beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import type { FeedEvent, Session } from "./types.ts";
import {
  activeFilter,
  defaultDirectory,
  events,
  filteredStream,
  kindFilter,
  lastSeen,
  latestPlanBySession,
  modalMode,
  patchForm,
  railGroups,
  searchQuery,
  sessionFilter,
  sessions,
  spawnForm,
  spawnValidationError,
  teams,
} from "./store.ts";

function makeEvent(overrides: Partial<FeedEvent>): FeedEvent {
  return { id: "e-1", ts: 1000, sid: "s-1", kind: "info", verb: "did something", own: false, resolved: null, ...overrides };
}

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: "s-1",
    name: "refactor session",
    short: "s1",
    baseName: "s",
    teamId: null,
    lead: false,
    status: "running",
    statusLine: "",
    phase: "executing",
    msDone: 0,
    msTotal: 4,
    startedAt: 0,
    cost: 0,
    model: "sonnet",
    effort: "medium",
    ctx: 0,
    dep: "",
    pendingModel: null,
    pendingEffort: null,
    pendingMove: null,
    dir: "/repo",
    worktreePath: null,
    branch: null,
    useWorktree: true,
    mcpConfigIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  sessions.value = [];
  teams.value = [];
  events.value = [];
  activeFilter.value = "all";
  kindFilter.value = [];
  searchQuery.value = "";
  sessionFilter.value = null;
  lastSeen.value = 0;
});

describe("filteredStream", () => {
  beforeEach(() => {
    events.value = [
      makeEvent({ id: "e-1", kind: "info", verb: "worktree created", ts: 100 }),
      makeEvent({ id: "e-2", kind: "error", verb: "spawn failed", ts: 200 }),
      makeEvent({ id: "e-3", kind: "artifact", verb: "report ready", ts: 300, sid: "s-2" }),
      makeEvent({ id: "e-4", kind: "approval", verb: "wants to run rm", ts: 400 }),
    ];
  });

  it("empty kind selection shows everything", () => {
    assertEquals(filteredStream.value.length, 4);
  });

  it("a single selected kind narrows to it", () => {
    kindFilter.value = ["error"];
    assertEquals(filteredStream.value.map((e) => e.id), ["e-2"]);
  });

  it("multiple selected kinds are a union", () => {
    kindFilter.value = ["error", "approval"];
    assertEquals(filteredStream.value.map((e) => e.id), ["e-2", "e-4"]);
  });

  it("kind filter composes with the unread view", () => {
    lastSeen.value = 250;
    activeFilter.value = "unread";
    kindFilter.value = ["approval"];
    // e-3 is unread but wrong kind; e-4 is unread and approval.
    assertEquals(filteredStream.value.map((e) => e.id), ["e-4"]);
  });

  it("unread excludes the agent's own events", () => {
    lastSeen.value = 0;
    events.value = [makeEvent({ id: "e-own", ts: 100, own: true }), makeEvent({ id: "e-other", ts: 100 })];
    activeFilter.value = "unread";
    assertEquals(filteredStream.value.map((e) => e.id), ["e-other"]);
  });

  it("session filter composes with kinds", () => {
    sessionFilter.value = "s-2";
    kindFilter.value = ["artifact", "error"];
    assertEquals(filteredStream.value.map((e) => e.id), ["e-3"]);
  });

  it("search matches verb, artifact name, and session name, case-insensitively", () => {
    sessions.value = [makeSession({ id: "s-2", name: "Docs Writer" })];
    events.value = [
      makeEvent({ id: "e-verb", verb: "Compiled the report" }),
      makeEvent({ id: "e-art", verb: "artifact", artName: "REPORT.md" }),
      makeEvent({ id: "e-sess", sid: "s-2", verb: "unrelated" }),
      makeEvent({ id: "e-miss", verb: "nothing here" }),
    ];

    searchQuery.value = "report";
    assertEquals(filteredStream.value.map((e) => e.id), ["e-verb", "e-art"]);

    searchQuery.value = "docs writer";
    assertEquals(filteredStream.value.map((e) => e.id), ["e-sess"]);
  });
});

describe("railGroups", () => {
  it("groups sessions under their team with the lead first, independents last", () => {
    teams.value = [{
      id: "tm-1",
      name: "Alpha",
      goal: "",
      dir: "/repo",
      baseRef: "HEAD",
      startedAt: 0,
      mcpConfigIds: [],
      coordination: "classic",
      workersStarted: true,
      useWorktree: true,
      boardSlug: null,
    }];
    sessions.value = [
      makeSession({ id: "s-w", teamId: "tm-1", lead: false }),
      makeSession({ id: "s-lead", teamId: "tm-1", lead: true }),
      makeSession({ id: "s-solo", teamId: null }),
    ];

    const groups = railGroups.value;
    assertEquals(groups.length, 2);
    assertEquals(groups[0].name, "Alpha");
    assertEquals(groups[0].sessions.map((s) => s.id), ["s-lead", "s-w"], "lead sorts first");
    assertEquals(groups[1].name, "Independent");
    assertEquals(groups[1].sessions.map((s) => s.id), ["s-solo"]);
  });
});

describe("latestPlanBySession", () => {
  it("keeps only the newest plan artifact per session", () => {
    events.value = [
      makeEvent({ id: "e-3", sid: "s-1", kind: "artifact", artName: "Plan", body: "newest" }),
      makeEvent({ id: "e-2", sid: "s-2", kind: "artifact", artName: "Plan", body: "other session" }),
      makeEvent({ id: "e-1", sid: "s-1", kind: "artifact", artName: "Plan", body: "oldest" }),
    ];

    const map = latestPlanBySession.value;
    assertEquals(map.get("s-1")?.body, "newest");
    assertEquals(map.get("s-2")?.body, "other session");
  });

  it("ignores non-plan artifacts and other event kinds", () => {
    events.value = [
      makeEvent({ id: "e-2", sid: "s-1", kind: "artifact", artName: "Report" }),
      makeEvent({ id: "e-1", sid: "s-1", kind: "message" }),
    ];

    assertEquals(latestPlanBySession.value.size, 0);
  });
});

describe("spawnValidationError", () => {
  beforeEach(() => {
    modalMode.value = "solo";
    patchForm(spawnForm, { promptText: "" });
    patchForm(spawnForm, { teamName: "" });
    patchForm(spawnForm, { dir: "" });
    patchForm(spawnForm, { targetTeamId: null });
    patchForm(spawnForm, { leadPlans: false });
    patchForm(spawnForm, { scheduleEnabled: false });
    patchForm(spawnForm, { draftMembers: [] });
    patchForm(spawnForm, { useDefaultDir: false });
    defaultDirectory.value = null;
  });

  it("solo: requires task, then an absolute directory", () => {
    assertEquals(spawnValidationError.value, "Task is required");
    patchForm(spawnForm, { promptText: "do the thing" });
    assertEquals(spawnValidationError.value, "Directory is required");
    patchForm(spawnForm, { dir: "relative/path" });
    assert(spawnValidationError.value!.includes("absolute"));
    patchForm(spawnForm, { dir: "/abs/path" });
    assertEquals(spawnValidationError.value, null);
  });

  it("new team: every member needs a task unless the lead plans", () => {
    modalMode.value = "new";
    patchForm(spawnForm, { teamName: "Alpha" });
    patchForm(spawnForm, { promptText: "goal" });
    patchForm(spawnForm, { dir: "/abs/repo" });
    patchForm(spawnForm, { draftMembers: [
      { task: "lead work", model: "sonnet", effort: "medium", name: "" },
      { task: "", model: "sonnet", effort: "medium", name: "" },
    ] });
    assertEquals(spawnValidationError.value, "Every member needs a task");

    // Lead-plans mode only validates the first member.
    patchForm(spawnForm, { leadPlans: true });
    assertEquals(spawnValidationError.value, null);
  });

  it("existing team: requires a task and a target team", () => {
    modalMode.value = "existing";
    assertEquals(spawnValidationError.value, "Task is required");
    patchForm(spawnForm, { promptText: "join in" });
    assertEquals(spawnValidationError.value, "Pick a team");
    patchForm(spawnForm, { targetTeamId: "tm-1" });
    assertEquals(spawnValidationError.value, null);
  });

  it("opting into the default directory skips the manual directory check", () => {
    patchForm(spawnForm, { promptText: "do the thing" });
    patchForm(spawnForm, { useDefaultDir: true });
    assert(spawnValidationError.value!.includes("No default directory set"));

    defaultDirectory.value = "/repo/project";
    assertEquals(spawnValidationError.value, null, "spawnDir stays empty but that's fine — the default fills in");
  });

  it("new team also honors the default-directory opt-in", () => {
    modalMode.value = "new";
    patchForm(spawnForm, { teamName: "Alpha" });
    patchForm(spawnForm, { promptText: "goal" });
    patchForm(spawnForm, { draftMembers: [{ task: "lead work", model: "sonnet", effort: "medium", name: "" }] });
    patchForm(spawnForm, { useDefaultDir: true });
    assert(spawnValidationError.value!.includes("No default directory set"));

    defaultDirectory.value = "/repo/project";
    assertEquals(spawnValidationError.value, null);
  });
});

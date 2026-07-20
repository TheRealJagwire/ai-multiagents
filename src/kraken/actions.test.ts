import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import { FakeTime } from "jsr:@std/testing/time";
import {
  approveEvent,
  denyEvent,
  dismissToast,
  ingestFeedEvent,
  queueModelChange,
  sendMessage,
  showToast,
  submitSpawn,
  undoToast,
} from "./actions.ts";
import {
  activeTab,
  chatDrafts,
  defaultDirectory,
  events,
  modalMode,
  modalOpen,
  patchForm,
  sessions,
  spawnError,
  spawnForm,
  teams,
  toasts,
} from "./store.ts";
import type { FeedEvent, Session } from "./types.ts";

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

function makeEvent(overrides: Partial<FeedEvent>): FeedEvent {
  return { id: "e-1", ts: 1000, sid: "s-1", kind: "approval", verb: "wants to run rm", own: false, resolved: null, ...overrides };
}

// Every network action funnels through fetch — recording it here exercises
// the real actions.ts → api.ts path instead of a mocked seam.
interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

let requests: RecordedRequest[];
let respond: (url: string) => Response;
const realFetch = globalThis.fetch;

let time: FakeTime;

beforeEach(() => {
  time = new FakeTime();
  requests = [];
  respond = () => new Response(null, { status: 204 });
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(respond(url));
  }) as typeof fetch;

  sessions.value = [];
  teams.value = [];
  events.value = [];
  toasts.value = [];
  chatDrafts.value = {};
  activeTab.value = "feed";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  time.restore();
});

describe("toasts", () => {
  it("caps the stack at three, dropping the oldest", () => {
    for (const label of ["one", "two", "three", "four"]) showToast(label);
    assertEquals(toasts.value.map((t) => t.label), ["two", "three", "four"]);
  });

  it("expires an info toast after its timeout", () => {
    showToast("ephemeral");
    assertEquals(toasts.value.length, 1);
    time.tick(5001);
    assertEquals(toasts.value.length, 0);
  });

  it("undoToast runs the undo callback exactly once and removes the toast", () => {
    let undone = 0;
    showToast("did a thing", () => undone++);
    const id = toasts.value[0].id;
    undoToast(id);
    assertEquals(undone, 1);
    assertEquals(toasts.value.length, 0);
    undoToast(id); // gone — must not fire again
    assertEquals(undone, 1);
  });

  it("dismissToast removes without running the undo", () => {
    let undone = 0;
    showToast("did a thing", () => undone++);
    dismissToast(toasts.value[0].id);
    assertEquals(undone, 0);
    assertEquals(toasts.value.length, 0);
  });
});

describe("approve/deny resolution flow", () => {
  beforeEach(() => {
    sessions.value = [makeSession({})];
    events.value = [makeEvent({})];
  });

  it("approve posts the scope, then offers an undo that hits /undo", async () => {
    await approveEvent("e-1", "session");
    assertEquals(requests, [{ url: "/api/kraken/events/e-1/approve", method: "POST", body: { scope: "session" } }]);
    assertEquals(toasts.value.map((t) => t.label), ["Approved s1"]);

    undoToast(toasts.value[0].id);
    await time.runMicrotasks();
    assertEquals(requests[1].url, "/api/kraken/undo/e-1");
  });

  it("a failed approve surfaces the server's error body as a toast, not a success", async () => {
    respond = () => new Response("agent already resolved it", { status: 409 });
    await approveEvent("e-1", "once");
    assertEquals(toasts.value.map((t) => t.label), ["Couldn't approve s1 — agent already resolved it"]);
  });

  it("deny posts and toasts with an undo", async () => {
    await denyEvent("e-1");
    assertEquals(requests[0].url, "/api/kraken/events/e-1/deny");
    assertEquals(toasts.value.map((t) => t.label), ["Denied s1"]);
    assert(toasts.value[0].undo, "deny is undoable");
  });
});

describe("sendMessage draft handling", () => {
  it("clears the draft on success", async () => {
    chatDrafts.value = { "s-1": "hello agent" };
    await sendMessage("s-1", "hello agent");
    assertEquals(requests[0].body, { text: "hello agent" });
    assertEquals(chatDrafts.value["s-1"], "");
  });

  it("restores the draft when the send fails", async () => {
    respond = () => new Response("backend gone", { status: 500 });
    await sendMessage("s-1", "hello agent");
    assertEquals(chatDrafts.value["s-1"], "hello agent", "failed send must not lose the typed text");
    assertEquals(toasts.value.map((t) => t.label), ["Couldn't send message — backend gone"]);
  });

  it("ignores whitespace-only messages without a request", async () => {
    await sendMessage("s-1", "   ");
    assertEquals(requests.length, 0);
  });
});

describe("queueModelChange", () => {
  it("queues a different model and offers an undo that cancels the pending change", async () => {
    sessions.value = [makeSession({ model: "sonnet" })];
    await queueModelChange("s-1", "opus");
    assertEquals(requests[0], { url: "/api/kraken/sessions/s-1/queue-model", method: "POST", body: { model: "opus" } });
    assertEquals(toasts.value.length, 1);

    undoToast(toasts.value[0].id);
    await time.runMicrotasks();
    assertEquals(requests[1].body, { kind: "model" });
    assertEquals(requests[1].url, "/api/kraken/sessions/s-1/cancel-pending");
  });

  it("re-picking the current model cancels instead of queueing", async () => {
    sessions.value = [makeSession({ model: "opus" })];
    await queueModelChange("s-1", "opus");
    assertEquals(requests.map((r) => r.url), ["/api/kraken/sessions/s-1/cancel-pending"]);
  });
});

describe("submitSpawn", () => {
  beforeEach(() => {
    modalMode.value = "solo";
    modalOpen.value = true;
    patchForm(spawnForm, { promptText: "" });
    patchForm(spawnForm, { teamName: "" });
    patchForm(spawnForm, { dir: "" });
    spawnError.value = null;
    patchForm(spawnForm, { useDefaultDir: false });
    patchForm(spawnForm, { scheduleEnabled: false });
    patchForm(spawnForm, { leadPlans: false });
    patchForm(spawnForm, { autonomousLead: false });
    defaultDirectory.value = null;
    patchForm(spawnForm, { targetTeamId: null });
    patchForm(spawnForm, { draftMembers: [] });
  });

  it("a validation error blocks the request entirely", async () => {
    await submitSpawn();
    assertEquals(requests.length, 0);
    assertEquals(spawnError.value, "Task is required");
    assertEquals(modalOpen.value, true);
  });

  it("solo success posts the spawn body, then resets and closes the modal", async () => {
    patchForm(spawnForm, { promptText: "fix the flaky test" });
    patchForm(spawnForm, { dir: "/repo/project" });
    await submitSpawn();

    assertEquals(requests.length, 1);
    const body = requests[0].body as Record<string, unknown>;
    assertEquals(requests[0].url, "/api/kraken/sessions");
    assertEquals(body.mode, "solo");
    assertEquals(body.task, "fix the flaky test");
    assertEquals(body.dir, "/repo/project");
    assertEquals(modalOpen.value, false);
    assertEquals(spawnForm.value.promptText, "", "successful spawn resets the form");
  });

  it("the default-directory opt-in fills dir from settings", async () => {
    patchForm(spawnForm, { promptText: "task" });
    patchForm(spawnForm, { useDefaultDir: true });
    defaultDirectory.value = "/home/me/proj";
    await submitSpawn();
    assertEquals((requests[0].body as Record<string, unknown>).dir, "/home/me/proj");
  });

  it("a failed spawn keeps the form as typed for a retry", async () => {
    respond = () => new Response("repo has no commits", { status: 400 });
    patchForm(spawnForm, { promptText: "fix the flaky test" });
    patchForm(spawnForm, { dir: "/repo/project" });
    await submitSpawn();

    assertEquals(spawnError.value, "repo has no commits");
    assertEquals(modalOpen.value, true);
    assertEquals(spawnForm.value.promptText, "fix the flaky test", "typed text survives the failure");
  });

  it("lead-plans team spawn sends only the lead row as a sequenced team, then lands on Teams", async () => {
    modalMode.value = "new";
    patchForm(spawnForm, { teamName: "Alpha" });
    patchForm(spawnForm, { promptText: "build the feature" });
    patchForm(spawnForm, { dir: "/repo/project" });
    patchForm(spawnForm, { leadPlans: true });
    patchForm(spawnForm, { draftMembers: [
      { task: "lead work", model: "opus", effort: "high", name: "" },
      { task: "", model: "sonnet", effort: "medium", name: "" },
    ] });
    await submitSpawn();

    const body = requests[0].body as Record<string, unknown>;
    assertEquals(body.coordination, "sequenced");
    assertEquals((body.members as unknown[]).length, 1, "only the lead row is meaningful when the lead plans");
    assertEquals(activeTab.value, "teams");
  });
});

describe("ingestFeedEvent", () => {
  it("prepends, keeping the feed newest-first", () => {
    events.value = [makeEvent({ id: "e-old", ts: 100 })];
    ingestFeedEvent(makeEvent({ id: "e-new", ts: 200 }));
    assertEquals(events.value.map((e) => e.id), ["e-new", "e-old"]);
  });
});

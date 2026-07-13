import { beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import type { Session } from "../../src/switchboard/types.ts";

// STATE_FILE binds to appDataDir() at import time — override first.
const dataDir = await Deno.makeTempDir({ prefix: "sb-state-test-" });
Deno.env.set("SWITCHBOARD_DATA_DIR", dataDir);
const { initPersistedState, persistStateSoon, STATE_FILE } = await import("./state-store.ts");
const { state, nextId, setIdCounter } = await import("./state.ts");

function makeSession(id: string, status: Session["status"]): Session {
  return {
    id,
    name: `session ${id}`,
    short: id,
    baseName: "s",
    teamId: null,
    lead: false,
    status,
    statusLine: "Working on task…",
    phase: "executing",
    msDone: 0,
    msTotal: 4,
    startedAt: Date.now(),
    cost: 1.23,
    model: "sonnet",
    effort: "medium",
    ctx: 10,
    dep: "",
    pendingModel: null,
    pendingEffort: null,
    pendingMove: null,
    dir: "/tmp/repo",
    worktreePath: null,
    branch: "switchboard/x",
    useWorktree: true,
    mcpConfigIds: [],
  };
}

function resetState(): void {
  state.sessions = [];
  state.teams = [];
  state.events = [];
  state.grants = [];
  state.transcripts = {};
  state.mcpConfigs = [];
  setIdCounter(0);
}

// persistStateSoon debounces 400ms; poll until the write lands.
async function waitForStateFile(): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      await Deno.stat(STATE_FILE);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`state file never appeared at ${STATE_FILE}`);
}

beforeEach(async () => {
  resetState();
  try {
    await Deno.remove(STATE_FILE);
  } catch {
    // already absent
  }
});

describe("state-store", () => {
  it("round-trips state and sanitizes previously-live sessions to stopped", async () => {
    state.sessions = [makeSession("s-1", "running"), makeSession("s-2", "done")];
    state.events = [{ id: "e-3", ts: 1, sid: "s-1", kind: "info", verb: "did a thing", own: false, resolved: null }];
    state.grants = [{ id: "g-4", sid: "s-1", pattern: "git *", grantedAt: 1 }];
    state.transcripts = { "s-1": [{ k: "text", text: "hello" }] };
    setIdCounter(4);
    persistStateSoon();
    await waitForStateFile();

    resetState();
    await initPersistedState();

    assertEquals(state.sessions.length, 2);
    const [s1, s2] = state.sessions;
    // The live one comes back stopped, honestly labeled, with a note.
    assertEquals(s1.status, "stopped");
    assertEquals(s1.phase, "stopped");
    assert(s1.statusLine.startsWith("App restarted"));
    assertEquals(state.transcripts["s-1"].at(-1)?.k, "note");
    // Cost/branch/history survive.
    assertEquals(s1.cost, 1.23);
    assertEquals(s1.branch, "switchboard/x");
    assertEquals(state.transcripts["s-1"][0], { k: "text", text: "hello" });
    // The already-terminal one is untouched and gets no note.
    assertEquals(s2.status, "done");
    assertEquals(state.transcripts["s-2"], undefined);

    assertEquals(state.events.length, 1);
    assertEquals(state.grants.length, 1);
  });

  it("idle sessions are live processes — restored as stopped like running ones", async () => {
    state.sessions = [makeSession("s-1", "idle")];
    persistStateSoon();
    await waitForStateFile();

    resetState();
    await initPersistedState();
    assertEquals(state.sessions[0].status, "stopped");
    assert(state.sessions[0].statusLine.startsWith("App restarted"));
  });

  it("does not stack restart notes across repeated restarts", async () => {
    state.sessions = [makeSession("s-1", "running")];
    persistStateSoon();
    await waitForStateFile();

    resetState();
    await initPersistedState(); // first restart: note added, session now stopped
    persistStateSoon();
    await new Promise((r) => setTimeout(r, 600)); // let the debounced write flush

    resetState();
    await initPersistedState(); // second restart: session was already stopped
    const notes = state.transcripts["s-1"].filter((m) => m.k === "note" && m.text?.startsWith("App restarted"));
    assertEquals(notes.length, 1);
  });

  it("restores the id counter so new ids never collide with restored ones", async () => {
    state.events = [{ id: "e-42", ts: 1, sid: "s-1", kind: "info", verb: "x", own: false, resolved: null }];
    setIdCounter(42);
    persistStateSoon();
    await waitForStateFile();

    resetState();
    await initPersistedState();
    assertEquals(nextId("e"), "e-43");
  });

  it("falls back to scanning restored ids when the stored counter is stale", async () => {
    // Simulate a file written by an older version: counter missing/low.
    await Deno.writeTextFile(
      STATE_FILE,
      JSON.stringify({
        counter: 0,
        sessions: [],
        teams: [],
        events: [{ id: "e-99", ts: 1, sid: "s-1", kind: "info", verb: "x", own: false, resolved: null }],
        grants: [],
        transcripts: {},
        mcpConfigs: [],
      }),
    );
    await initPersistedState();
    assertEquals(nextId("e"), "e-100");
  });

  it("a corrupt state file degrades to empty state instead of failing startup", async () => {
    await Deno.writeTextFile(STATE_FILE, "{definitely not json");
    await initPersistedState();
    assertEquals(state.sessions, []);
    assertEquals(state.events, []);
  });

  it("missing fields in an old-version file degrade to empty, not undefined", async () => {
    await Deno.writeTextFile(STATE_FILE, JSON.stringify({ counter: 1, sessions: [makeSession("s-1", "error")] }));
    await initPersistedState();
    assertEquals(state.sessions.length, 1);
    assertEquals(state.events, []);
    assertEquals(state.grants, []);
    assertEquals(state.mcpConfigs, []);
  });

  it("writes state.json owner-only (0600) on POSIX — transcripts can hold secrets", async () => {
    if (Deno.build.os === "windows") return;
    state.sessions = [makeSession("s-1", "done")];
    persistStateSoon();
    await waitForStateFile();
    const info = await Deno.stat(STATE_FILE);
    assertEquals(info.mode! & 0o777, 0o600);
  });

  it("caps persisted events at the newest 1000", async () => {
    state.events = Array.from({ length: 1050 }, (_, i) => ({
      id: `e-${i + 1}`,
      ts: i,
      sid: "s-1",
      kind: "info" as const,
      verb: `event ${i}`,
      own: false,
      resolved: null,
    }));
    persistStateSoon();
    await waitForStateFile();

    const onDisk = JSON.parse(await Deno.readTextFile(STATE_FILE));
    assertEquals(onDisk.events.length, 1000);
    // state.events is newest-first; the cap keeps the front of the array.
    assertEquals(onDisk.events[0].id, "e-1");
  });
});

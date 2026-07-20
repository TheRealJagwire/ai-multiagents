import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import type { Session, Team } from "../../src/kraken/types.ts";

// team-actions.ts pulls in state-store.ts (STATE_FILE) and orchestration's
// kv.ts (its own KV dir under the same app-data root) — both bind via
// appDataDir() at import time, so the override must land before any of
// these modules are imported.
Deno.env.set("KRAKEN_DATA_DIR", await Deno.makeTempDir({ prefix: "sb-team-actions-test-" }));
const { deleteTeam } = await import("./team-actions.ts");
const { state, setIdCounter } = await import("./state.ts");
const { createBoard, resolveBoard } = await import("../orchestration/service.ts");
const { getKv } = await import("../orchestration/kv.ts");

function makeTeam(overrides: Partial<Team>): Team {
  return {
    id: "tm-1",
    name: "Test team",
    goal: "",
    dir: "/repo",
    baseRef: "HEAD",
    startedAt: 0,
    mcpConfigIds: [],
    coordination: "classic",
    workersStarted: true,
    useWorktree: true,
    boardSlug: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: "s-1",
    name: "member",
    short: "member",
    baseName: "member",
    teamId: "tm-1",
    lead: false,
    status: "done",
    statusLine: "",
    phase: "done",
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

async function boardExistsAndIsLive(slug: string): Promise<boolean> {
  const kv = await getKv();
  const board = await resolveBoard(kv, slug);
  return board !== null && !board.archivedAt;
}

beforeEach(() => {
  state.sessions = [];
  state.teams = [];
  state.events = [];
  state.grants = [];
  state.transcripts = {};
  setIdCounter(0);
});

afterEach(async () => {
  // Let any debounced state.json write flush so the timer sanitizer passes.
  await new Promise((r) => setTimeout(r, 500));
});

describe("deleteTeam: board lifecycle", () => {
  it("archives the linked board once no team references it anymore", async () => {
    const kv = await getKv();
    const created = await createBoard(kv, { slug: "solo-team-board", title: "t" });
    assert(!("error" in created));

    state.teams = [makeTeam({ id: "tm-1", boardSlug: "solo-team-board" })];
    state.sessions = [makeSession({ id: "s-1", teamId: "tm-1" })];

    deleteTeam("tm-1");
    // The archive is fire-and-forget (async) — give its microtasks a beat.
    await new Promise((r) => setTimeout(r, 50));

    assertEquals(await boardExistsAndIsLive("solo-team-board"), false);
    const board = await resolveBoard(kv, "solo-team-board");
    assert(board?.archivedAt !== undefined);
  });

  it("does not archive a board still linked by another team", async () => {
    const kv = await getKv();
    await createBoard(kv, { slug: "shared-board", title: "t" });

    state.teams = [
      makeTeam({ id: "tm-1", boardSlug: "shared-board" }),
      makeTeam({ id: "tm-2", boardSlug: "shared-board" }),
    ];
    state.sessions = [makeSession({ id: "s-1", teamId: "tm-1" })];

    deleteTeam("tm-1");
    await new Promise((r) => setTimeout(r, 50));

    assertEquals(await boardExistsAndIsLive("shared-board"), true, "second team still links this board");
    assertEquals(state.teams.map((t) => t.id), ["tm-2"], "the deleted team itself is gone");

    // Deleting the last team referencing it now archives it.
    deleteTeam("tm-2");
    await new Promise((r) => setTimeout(r, 50));
    assertEquals(await boardExistsAndIsLive("shared-board"), false);
  });

  it("deleting a team with no board link never touches the orchestration server", async () => {
    state.teams = [makeTeam({ id: "tm-1", boardSlug: null })];
    state.sessions = [makeSession({ id: "s-1", teamId: "tm-1" })];

    deleteTeam("tm-1");
    await new Promise((r) => setTimeout(r, 50));

    assertEquals(state.teams, []);
    // No throw, no dangling state — nothing further to assert; reaching
    // here without an unhandled rejection is the point of this test.
  });

  it("a boardSlug pointing at a board that was never created is a silent no-op", async () => {
    state.teams = [makeTeam({ id: "tm-1", boardSlug: "never-created-board" })];
    state.sessions = [makeSession({ id: "s-1", teamId: "tm-1" })];

    deleteTeam("tm-1");
    await new Promise((r) => setTimeout(r, 50));

    assertEquals(state.teams, []);
    const kv = await getKv();
    assertEquals(await resolveBoard(kv, "never-created-board"), null);
  });
});

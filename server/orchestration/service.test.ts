import { assert, assertEquals } from "jsr:@std/assert";
import {
  claimCard,
  claimNextCard,
  completeCard,
  createBoard,
  createCard,
  getAgent,
  getCard,
  heartbeat,
  listCards,
  listEvents,
  moveCard,
  registerAgent,
  sweepBoard,
} from "./service.ts";

async function freshKv(): Promise<Deno.Kv> {
  return await Deno.openKv(":memory:");
}

async function mustCreateBoard(kv: Deno.Kv, slug: string, overrides?: { leaseMs?: number; heartbeatMs?: number }) {
  const board = await createBoard(kv, { slug, title: slug, ...overrides });
  if ("error" in board) throw new Error(board.error);
  return board;
}

async function mustRegister(kv: Deno.Kv, boardId: string, name: string) {
  return await registerAgent(kv, boardId, { name, role: "implementer" });
}

// M1 acceptance criteria (plan section 8): 20 concurrent claim_next_card
// calls against 5 ready cards must yield exactly 5 winners and clean indexes.
Deno.test("claimNextCard: 20 concurrent claims against 5 ready cards yields exactly 5 winners", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "race-test");
    for (let i = 0; i < 5; i++) {
      await createCard(kv, board.id, { title: `Card ${i}`, description: "x" });
    }

    const agents = await Promise.all(Array.from({ length: 20 }, (_, i) => mustRegister(kv, board.id, `agent-${i}`)));
    const results = await Promise.all(agents.map((agent) => claimNextCard(kv, board.id, agent.id)));

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assertEquals(winners.length, 5);
    assertEquals(losers.length, 15);

    const claimedCardIds = new Set(winners.map((w) => (w.ok ? w.card.id : "")));
    assertEquals(claimedCardIds.size, 5, "each winning claim landed on a distinct card");

    const assignees = new Set(winners.map((w) => (w.ok ? w.card.assignee : "")));
    assertEquals(assignees.size, 5, "each winning claim was made by a distinct agent");

    // Index cleanliness: nothing left in "ready", exactly 5 in "in_progress".
    const ready = await listCards(kv, board.id, { status: "ready" });
    const inProgress = await listCards(kv, board.id, { status: "in_progress" });
    assertEquals(ready.length, 0);
    assertEquals(inProgress.length, 5);

    // The by-agent index agrees with each card's own assignee field.
    for (const card of inProgress) {
      assert(card.assignee);
      const byAgent = await listCards(kv, board.id, { assignee: card.assignee });
      assertEquals(byAgent.length, 1);
      assertEquals(byAgent[0].id, card.id);

      // The agent's own currentCardId agrees too (M2: claim keeps both sides in sync).
      const agentRecord = await getAgent(kv, board.id, card.assignee);
      assertEquals(agentRecord?.currentCardId, card.id);
      assertEquals(agentRecord?.status, "working");
    }

    // Exactly one card.claimed event per card, no duplicates from retries leaking through.
    const events = await listEvents(kv, board.id);
    assertEquals(events.filter((e) => e.type === "card.claimed").length, 5);
  } finally {
    kv.close();
  }
});

// M1 acceptance criteria: identical operations on two boards never touch
// each other's keys or events.
Deno.test("boards are fully isolated from each other", async () => {
  const kv = await freshKv();
  try {
    const boardA = await mustCreateBoard(kv, "board-a");
    const boardB = await mustCreateBoard(kv, "board-b");
    const agentA = await mustRegister(kv, boardA.id, "agent-a");
    const agentB = await mustRegister(kv, boardB.id, "agent-b");

    const cardA = await createCard(kv, boardA.id, { title: "Only in A", description: "x" });
    const cardB = await createCard(kv, boardB.id, { title: "Only in B", description: "x" });

    await claimNextCard(kv, boardA.id, agentA.id);
    await claimNextCard(kv, boardB.id, agentB.id);

    const cardsA = await listCards(kv, boardA.id);
    const cardsB = await listCards(kv, boardB.id);
    assertEquals(cardsA.length, 1);
    assertEquals(cardsB.length, 1);
    assertEquals(cardsA[0].id, cardA.id);
    assertEquals(cardsB[0].id, cardB.id);

    // An agent that only ever acted on board A shows up nowhere on board B.
    assertEquals((await listCards(kv, boardA.id, { assignee: agentB.id })).length, 0);
    assertEquals((await listCards(kv, boardB.id, { assignee: agentA.id })).length, 0);
    // Same identity check for the agent records themselves — registering on
    // one board must not leak an agent record onto another.
    assertEquals(await getAgent(kv, boardA.id, agentB.id), null);
    assertEquals(await getAgent(kv, boardB.id, agentA.id), null);

    const eventsA = await listEvents(kv, boardA.id);
    const eventsB = await listEvents(kv, boardB.id);
    assert(eventsA.length > 0 && eventsB.length > 0);
    assert(eventsA.every((e) => e.boardId === boardA.id));
    assert(eventsB.every((e) => e.boardId === boardB.id));

    // A card's ID from board B doesn't resolve when looked up under board A.
    assertEquals(await getCard(kv, boardA.id, cardB.id), null);
  } finally {
    kv.close();
  }
});

Deno.test("createBoard: concurrent creates with the same slug yield exactly one winner", async () => {
  const kv = await freshKv();
  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createBoard(kv, { slug: "shared-slug", title: "T" })),
    );
    const created = results.filter((r) => !("error" in r));
    const errored = results.filter((r) => "error" in r);
    assertEquals(created.length, 1);
    assertEquals(errored.length, 9);
  } finally {
    kv.close();
  }
});

Deno.test("createCard: a card with dependencies starts in backlog and becomes ready once they're done", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "deps");
    const agent = await mustRegister(kv, board.id, "agent-1");
    const upstream = await createCard(kv, board.id, { title: "Upstream", description: "x" });
    const downstream = await createCard(kv, board.id, {
      title: "Downstream",
      description: "x",
      dependsOn: [upstream.id],
    });
    assertEquals(downstream.status, "backlog");

    const claimed = await claimCard(kv, board.id, agent.id, upstream.id);
    assert(claimed.ok);
    await completeCard(kv, board.id, upstream.id, agent.id, "done!");

    const refreshed = await getCard(kv, board.id, downstream.id);
    assertEquals(refreshed?.status, "ready");

    const events = await listEvents(kv, board.id);
    assert(events.some((e) => e.cardId === downstream.id && e.type === "card.moved"));

    // Completing releases the agent — get_team_status should show it idle
    // and free, not still "holding" a card that's done.
    const agentRecord = await getAgent(kv, board.id, agent.id);
    assertEquals(agentRecord?.status, "idle");
    assertEquals(agentRecord?.currentCardId, undefined);
  } finally {
    kv.close();
  }
});

Deno.test("claimCard: refuses a card whose fileScope overlaps an in-progress card", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "scope");
    const agent1 = await mustRegister(kv, board.id, "agent-1");
    const agent2 = await mustRegister(kv, board.id, "agent-2");
    const first = await createCard(kv, board.id, { title: "First", description: "x", fileScope: ["src/api/**"] });
    const second = await createCard(kv, board.id, {
      title: "Second",
      description: "x",
      fileScope: ["src/api/handlers.ts"],
    });

    const firstClaim = await claimCard(kv, board.id, agent1.id, first.id);
    assert(firstClaim.ok);

    const secondClaim = await claimCard(kv, board.id, agent2.id, second.id);
    assert(!secondClaim.ok);
    assertEquals(secondClaim.nearMisses[0]?.reason, "scope_conflict");
  } finally {
    kv.close();
  }
});

Deno.test("claimCard/claimNextCard: refuse an unregistered agent", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "no-agent");
    const card = await createCard(kv, board.id, { title: "Task", description: "x" });

    const next = await claimNextCard(kv, board.id, "not-a-real-agent");
    assert(!next.ok);

    const targeted = await claimCard(kv, board.id, "not-a-real-agent", card.id);
    assert(!targeted.ok);

    const refreshed = await getCard(kv, board.id, card.id);
    assertEquals(refreshed?.status, "ready");
  } finally {
    kv.close();
  }
});

Deno.test("registerAgent: same name upserts idempotently instead of creating duplicates", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "idempotent");
    const first = await registerAgent(kv, board.id, { name: "worker-1", role: "implementer" });
    const second = await registerAgent(kv, board.id, { name: "worker-1", role: "reviewer" });
    assertEquals(first.id, second.id);
    assertEquals(second.role, "reviewer");
  } finally {
    kv.close();
  }
});

// M2 acceptance criteria (plan section 8): kill a fake worker mid-claim,
// assert the card returns to "ready" after lease expiry with the right event.
Deno.test("reaper: expired lease releases an in-progress card back to ready", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "reaper-lease", { leaseMs: 1 });
    const agent = await mustRegister(kv, board.id, "worker-1");
    const card = await createCard(kv, board.id, { title: "Task", description: "x" });

    const claimed = await claimCard(kv, board.id, agent.id, card.id);
    assert(claimed.ok);

    // Simulate the worker crashing: no further progress/heartbeat, just
    // wait past the (deliberately tiny) lease.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const result = await sweepBoard(kv, board);
    assertEquals(result.cardsReleased, [card.id]);

    const refreshed = await getCard(kv, board.id, card.id);
    assertEquals(refreshed?.status, "ready");
    assertEquals(refreshed?.assignee, undefined);
    assertEquals((await listCards(kv, board.id, { assignee: agent.id })).length, 0);

    const events = await listEvents(kv, board.id);
    assert(events.some((e) => e.type === "card.lease_expired" && e.cardId === card.id));

    const refreshedAgent = await getAgent(kv, board.id, agent.id);
    assertEquals(refreshedAgent?.status, "idle");
    assertEquals(refreshedAgent?.currentCardId, undefined);
  } finally {
    kv.close();
  }
});

Deno.test("reaper: does not touch blocked cards even past lease", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "reaper-blocked", { leaseMs: 1 });
    const agent = await mustRegister(kv, board.id, "worker-1");
    const card = await createCard(kv, board.id, { title: "Task", description: "x" });
    const claimed = await claimCard(kv, board.id, agent.id, card.id);
    assert(claimed.ok);

    await moveCard(kv, board.id, card.id, agent.id, "blocked", "waiting on design review");

    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await sweepBoard(kv, board);
    assertEquals(result.cardsReleased, []);

    const refreshed = await getCard(kv, board.id, card.id);
    assertEquals(refreshed?.status, "blocked");
    assertEquals(refreshed?.assignee, agent.id);
  } finally {
    kv.close();
  }
});

Deno.test("reaper: agent past the heartbeat threshold is marked offline", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "reaper-heartbeat", { heartbeatMs: 1 });
    const agent = await mustRegister(kv, board.id, "worker-1");

    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await sweepBoard(kv, board);
    assertEquals(result.agentsMarkedOffline, [agent.id]);

    const refreshed = await getAgent(kv, board.id, agent.id);
    assertEquals(refreshed?.status, "offline");

    const events = await listEvents(kv, board.id);
    assert(events.some((e) => e.type === "agent.offline" && e.actor === "system"));
  } finally {
    kv.close();
  }
});

Deno.test("heartbeat: renews the lease on the agent's current card", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "heartbeat-renew", { leaseMs: 50 });
    const agent = await mustRegister(kv, board.id, "worker-1");
    const card = await createCard(kv, board.id, { title: "Task", description: "x" });
    const claimed = await claimCard(kv, board.id, agent.id, card.id);
    assert(claimed.ok);
    const originalLease = claimed.card.leaseExpiresAt!;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await heartbeat(kv, board.id, agent.id);

    const refreshed = await getCard(kv, board.id, card.id);
    assert(refreshed!.leaseExpiresAt! > originalLease, "heartbeat should have pushed the lease forward");
  } finally {
    kv.close();
  }
});

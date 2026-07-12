import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  checkMessages,
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
  sendMessage,
  sweepBoard,
  watchEvents,
} from "./service.ts";

async function freshKv(): Promise<Deno.Kv> {
  return await Deno.openKv(":memory:");
}

async function mustCreateBoard(kv: Deno.Kv, slug: string, overrides?: { leaseMs?: number; heartbeatMs?: number; eventRetentionMs?: number }) {
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

Deno.test("createCard: rejects a dependsOn id that does not exist on the board", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "deps-unknown");
    const err = await assertRejects(
      () => createCard(kv, board.id, { title: "Orphan", description: "x", dependsOn: ["01FAKEDEPENDENCYID0000000"] }),
      Error,
      "unknown dependsOn card(s): 01FAKEDEPENDENCYID0000000",
    );
    assert(err.message.includes("01FAKEDEPENDENCYID0000000"), "error names the unknown id");

    // Nothing was written — the board has no cards and no card.created event.
    assertEquals((await listCards(kv, board.id)).length, 0);
    const events = await listEvents(kv, board.id);
    assert(events.every((e) => e.type !== "card.created"));
  } finally {
    kv.close();
  }
});

Deno.test("createCard: a valid existing dependsOn still succeeds and starts in backlog", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "deps-valid");
    const upstream = await createCard(kv, board.id, { title: "Upstream", description: "x" });
    const downstream = await createCard(kv, board.id, {
      title: "Downstream",
      description: "x",
      dependsOn: [upstream.id],
    });
    assertEquals(downstream.status, "backlog");
    assertEquals(downstream.dependsOn, [upstream.id]);
  } finally {
    kv.close();
  }
});

Deno.test("createCard: one valid + one unknown dependsOn throws naming only the unknown id", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "deps-mixed");
    const upstream = await createCard(kv, board.id, { title: "Upstream", description: "x" });
    const err = await assertRejects(
      () => createCard(kv, board.id, { title: "Mixed", description: "x", dependsOn: [upstream.id, "01FAKEDEPENDENCYID0000000"] }),
      Error,
      "unknown dependsOn card(s): 01FAKEDEPENDENCYID0000000",
    );
    assert(!err.message.includes(upstream.id), "error does not name the valid id");

    // Only the upstream card exists; the rejected card wrote nothing.
    const cards = await listCards(kv, board.id);
    assertEquals(cards.length, 1);
    assertEquals(cards[0].id, upstream.id);
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

// M4 acceptance test (plan section 8): two concurrent sessions exchanging a
// message about a shared interface — the scenario the whole messaging
// design exists for (an agent changes a contract another agent's card
// depends on, and tells them before either assumes anything).
Deno.test("messaging: two agents exchange a direct message about a shared interface", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "msg-direct");
    const backend = await mustRegister(kv, board.id, "backend-worker");
    const frontend = await mustRegister(kv, board.id, "frontend-worker");

    // frontend has nothing yet — checking messages drains an empty inbox.
    assertEquals(await checkMessages(kv, board.id, frontend.id), []);

    const sent = await sendMessage(kv, board.id, {
      from: backend.id,
      to: frontend.id,
      body: "Changed /api/users response shape: `name` split into `firstName`/`lastName`.",
    });
    assertEquals(sent.from, backend.id);
    assertEquals(sent.to, frontend.id);

    // The message shows up in a board event too, so watch_events-only
    // consumers (e.g. a human tailing SSE) still see that it happened.
    const events = await listEvents(kv, board.id);
    assert(events.some((e) => e.type === "message.sent" && e.actor === backend.id));

    const inbox = await checkMessages(kv, board.id, frontend.id);
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0].body, sent.body);

    // Inbox semantics: read messages are deleted, so a second drain is empty.
    assertEquals(await checkMessages(kv, board.id, frontend.id), []);
    // backend's own inbox is untouched by frontend's read.
    assertEquals(await checkMessages(kv, board.id, backend.id), []);
  } finally {
    kv.close();
  }
});

Deno.test("messaging: broadcast is a shared ring each agent reads once via its own cursor", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "msg-broadcast");
    const lead = await mustRegister(kv, board.id, "lead");
    const workerA = await mustRegister(kv, board.id, "worker-a");
    const workerB = await mustRegister(kv, board.id, "worker-b");

    await sendMessage(kv, board.id, { from: lead.id, to: "*", body: "freeze on src/api/** until further notice" });

    const seenByA = await checkMessages(kv, board.id, workerA.id);
    const seenByB = await checkMessages(kv, board.id, workerB.id);
    assertEquals(seenByA.length, 1);
    assertEquals(seenByB.length, 1);
    assertEquals(seenByA[0].body, seenByB[0].body);

    // Each reader's cursor advanced independently — a second check for A
    // sees nothing new, but a fresh broadcast is picked up by both again.
    assertEquals(await checkMessages(kv, board.id, workerA.id), []);
    await sendMessage(kv, board.id, { from: lead.id, to: "*", body: "freeze lifted" });
    assertEquals((await checkMessages(kv, board.id, workerA.id)).length, 1);
    assertEquals((await checkMessages(kv, board.id, workerB.id)).length, 1);
  } finally {
    kv.close();
  }
});

Deno.test("messaging: sendMessage rejects unregistered from/to agents", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "msg-unregistered");
    const agent = await mustRegister(kv, board.id, "worker-1");

    await assertRejects(() => sendMessage(kv, board.id, { from: "not-an-agent", to: agent.id, body: "hi" }));
    await assertRejects(() => sendMessage(kv, board.id, { from: agent.id, to: "not-an-agent", body: "hi" }));
  } finally {
    kv.close();
  }
});

Deno.test("watchEvents: advances the cursor and only returns events past it", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "watch-events");
    const agent = await mustRegister(kv, board.id, "watcher");
    await createCard(kv, board.id, { title: "Card 1", description: "x" });

    const first = await watchEvents(kv, board.id, agent.id);
    assert(first.length > 0);

    // Nothing new since the cursor advanced.
    assertEquals(await watchEvents(kv, board.id, agent.id), []);

    await createCard(kv, board.id, { title: "Card 2", description: "y" });
    const second = await watchEvents(kv, board.id, agent.id);
    assertEquals(second.length, 1);
    assertEquals(second[0].detail, "Card 2");
  } finally {
    kv.close();
  }
});

Deno.test("heartbeat: reports unread-message and new-event counts without consuming them", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "heartbeat-counts");
    const agent = await mustRegister(kv, board.id, "worker-1");
    const other = await mustRegister(kv, board.id, "worker-2");

    await sendMessage(kv, board.id, { from: other.id, to: agent.id, body: "hey" });
    await createCard(kv, board.id, { title: "New card", description: "x" });

    const result = await heartbeat(kv, board.id, agent.id);
    assertEquals(result.agent.id, agent.id);
    assert(result.unreadMessages >= 1, "should see the unread inbox message");
    assert(result.newEvents >= 1, "should see the new card.created event");

    // A peek, not a drain — the message and events are still there for the
    // agent's actual check_messages/watch_events calls.
    assertEquals((await checkMessages(kv, board.id, agent.id)).length, 1);
    assert((await watchEvents(kv, board.id, agent.id)).length >= 1);
  } finally {
    kv.close();
  }
});

// ---------- M6 hardening ----------

// Exercises scopesOverlap through the public claim path: agent1 holds a
// card with scopeA in_progress; whether agent2 can claim a card with scopeB
// tells us if the scopes were judged to overlap.
async function scopesConflict(scopeA: string[], scopeB: string[]): Promise<boolean> {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "scope-check");
    const a1 = await mustRegister(kv, board.id, "holder");
    const a2 = await mustRegister(kv, board.id, "challenger");
    const cardA = await createCard(kv, board.id, { title: "A", description: "x", fileScope: scopeA });
    const cardB = await createCard(kv, board.id, { title: "B", description: "x", fileScope: scopeB });
    const first = await claimCard(kv, board.id, a1.id, cardA.id);
    assert(first.ok, "holder must claim its card");
    const second = await claimCard(kv, board.id, a2.id, cardB.id);
    return !second.ok;
  } finally {
    kv.close();
  }
}

Deno.test("fileScope: segment-aware overlap fixes prefix false positives and normalization", async () => {
  // Old prefix heuristic called this a conflict ("src/api" is a string
  // prefix of "src/apifoo.ts") — segment matching must not.
  assertEquals(await scopesConflict(["src/api"], ["src/apifoo.ts"]), false);
  // "./"-prefixed patterns are the same paths after normalization.
  assertEquals(await scopesConflict(["./src/api/x.ts"], ["src/api/**"]), true);
  // "**" spans zero segments: a dir glob overlaps the bare dir path.
  assertEquals(await scopesConflict(["src/api/**"], ["src/api"]), true);
  // A leading "**" can land inside any directory.
  assertEquals(await scopesConflict(["**/*.test.ts"], ["src/**"]), true);
  // Genuinely disjoint trees stay parallel.
  assertEquals(await scopesConflict(["docs/*.md"], ["src/**"]), false);
  assertEquals(await scopesConflict(["server/orchestration/routes.ts"], ["server/orchestration/service.test.ts"]), false);
});

Deno.test("createCard: dependsOn is deduped and already-done deps start the card ready", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "deps-hygiene");
    const agent = await mustRegister(kv, board.id, "worker-1");

    const dep = await createCard(kv, board.id, { title: "Dep", description: "x" });
    assert((await claimCard(kv, board.id, agent.id, dep.id)).ok);
    await completeCard(kv, board.id, dep.id, agent.id, "done");

    // Depending only on an already-done card must not strand it in backlog
    // (unblockDependents never fires again for that dep).
    const late = await createCard(kv, board.id, { title: "Late joiner", description: "x", dependsOn: [dep.id, dep.id] });
    assertEquals(late.status, "ready");
    assertEquals(late.dependsOn, [dep.id], "duplicate ids collapse to one");

    // A mix of done + not-done still waits.
    const open = await createCard(kv, board.id, { title: "Open dep", description: "x" });
    const waiting = await createCard(kv, board.id, { title: "Waiting", description: "x", dependsOn: [dep.id, open.id] });
    assertEquals(waiting.status, "backlog");
  } finally {
    kv.close();
  }
});

Deno.test("heartbeat: revives a reaped-offline agent to idle unless told otherwise", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "revive", { heartbeatMs: 1 });
    const agent = await mustRegister(kv, board.id, "sleepy");
    await new Promise((r) => setTimeout(r, 20));
    const swept = await sweepBoard(kv, board);
    assert(swept.agentsMarkedOffline.includes(agent.id));

    // A plain heartbeat is proof of life — back to idle.
    const hb = await heartbeat(kv, board.id, agent.id);
    assertEquals(hb.agent.status, "idle");

    // An explicit status still wins (the SessionEnd hook sends "offline").
    const explicit = await heartbeat(kv, board.id, agent.id, "offline");
    assertEquals(explicit.agent.status, "offline");
  } finally {
    kv.close();
  }
});

Deno.test("sweepBoard: compacts events older than the board's retention window", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "compaction", { eventRetentionMs: 1 });
    await createCard(kv, board.id, { title: "Old news", description: "x" });
    await createCard(kv, board.id, { title: "Older news", description: "x" });
    assertEquals((await listEvents(kv, board.id)).length, 2);

    await new Promise((r) => setTimeout(r, 20));
    const swept = await sweepBoard(kv, board);
    assertEquals(swept.eventsCompacted, 2);
    assertEquals((await listEvents(kv, board.id)).length, 0);
  } finally {
    kv.close();
  }
});

Deno.test("registerAgent: fresh agents start with cursors at now — no self-registration noise", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "cursor-init");
    const early = await mustRegister(kv, board.id, "early-bird");
    await sendMessage(kv, board.id, { from: early.id, to: "*", body: "old broadcast" });
    await createCard(kv, board.id, { title: "Old card", description: "x" });

    // A newcomer sees none of that history — and not its own registration.
    const late = await mustRegister(kv, board.id, "late-joiner");
    const hb = await heartbeat(kv, board.id, late.id);
    assertEquals(hb.newEvents, 0);
    assertEquals(hb.unreadMessages, 0);
    assertEquals(await watchEvents(kv, board.id, late.id), []);
    assertEquals(await checkMessages(kv, board.id, late.id), []);

    // But everything from here on is news.
    await createCard(kv, board.id, { title: "Fresh card", description: "x" });
    assertEquals((await heartbeat(kv, board.id, late.id)).newEvents, 1);

    // Re-registering (session resume) keeps the cursor position.
    await mustRegister(kv, board.id, "late-joiner");
    assertEquals((await heartbeat(kv, board.id, late.id)).newEvents, 1);
  } finally {
    kv.close();
  }
});

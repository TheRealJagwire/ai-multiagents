import { assert, assertEquals } from "jsr:@std/assert";
import {
  claimCard,
  claimNextCard,
  completeCard,
  createBoard,
  createCard,
  getCard,
  listCards,
  listEvents,
} from "./service.ts";

async function freshKv(): Promise<Deno.Kv> {
  return await Deno.openKv(":memory:");
}

async function mustCreateBoard(kv: Deno.Kv, slug: string) {
  const board = await createBoard(kv, { slug, title: slug });
  if ("error" in board) throw new Error(board.error);
  return board;
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

    const agentIds = Array.from({ length: 20 }, (_, i) => `agent-${i}`);
    const results = await Promise.all(agentIds.map((agentId) => claimNextCard(kv, board.id, agentId)));

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

    const cardA = await createCard(kv, boardA.id, { title: "Only in A", description: "x" });
    const cardB = await createCard(kv, boardB.id, { title: "Only in B", description: "x" });

    await claimNextCard(kv, boardA.id, "agent-a");
    await claimNextCard(kv, boardB.id, "agent-b");

    const cardsA = await listCards(kv, boardA.id);
    const cardsB = await listCards(kv, boardB.id);
    assertEquals(cardsA.length, 1);
    assertEquals(cardsB.length, 1);
    assertEquals(cardsA[0].id, cardA.id);
    assertEquals(cardsB[0].id, cardB.id);

    // An agent that only ever acted on board A shows up nowhere on board B.
    assertEquals((await listCards(kv, boardA.id, { assignee: "agent-b" })).length, 0);
    assertEquals((await listCards(kv, boardB.id, { assignee: "agent-a" })).length, 0);

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
    const upstream = await createCard(kv, board.id, { title: "Upstream", description: "x" });
    const downstream = await createCard(kv, board.id, {
      title: "Downstream",
      description: "x",
      dependsOn: [upstream.id],
    });
    assertEquals(downstream.status, "backlog");

    const claimed = await claimCard(kv, board.id, "agent-1", upstream.id);
    assert(claimed.ok);
    await completeCard(kv, board.id, upstream.id, "agent-1", "done!");

    const refreshed = await getCard(kv, board.id, downstream.id);
    assertEquals(refreshed?.status, "ready");

    const events = await listEvents(kv, board.id);
    assert(events.some((e) => e.cardId === downstream.id && e.type === "card.moved"));
  } finally {
    kv.close();
  }
});

Deno.test("claimCard: refuses a card whose fileScope overlaps an in-progress card", async () => {
  const kv = await freshKv();
  try {
    const board = await mustCreateBoard(kv, "scope");
    const first = await createCard(kv, board.id, { title: "First", description: "x", fileScope: ["src/api/**"] });
    const second = await createCard(kv, board.id, {
      title: "Second",
      description: "x",
      fileScope: ["src/api/handlers.ts"],
    });

    const firstClaim = await claimCard(kv, board.id, "agent-1", first.id);
    assert(firstClaim.ok);

    const secondClaim = await claimCard(kv, board.id, "agent-2", second.id);
    assert(!secondClaim.ok);
    assertEquals(secondClaim.nearMisses[0]?.reason, "scope_conflict");
  } finally {
    kv.close();
  }
});

import { afterAll, afterEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";

// Importing routes.ts opens KV (at the app-data dir) and boots the reaper —
// point storage at a temp dir first, and stop the reaper's interval after,
// or the timer sanitizer fails the run.
Deno.env.set("KRAKEN_DATA_DIR", await Deno.makeTempDir({ prefix: "orch-routes-test-" }));
const { orchestrationApp } = await import("./routes.ts");
const { stopReaper } = await import("./service.ts");

afterAll(() => {
  stopReaper();
});

afterEach(() => {
  Deno.env.delete("ORCHESTRATION_TOKEN");
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await orchestrationApp.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function mustJson<T>(res: Response, status: number): Promise<T> {
  assertEquals(res.status, status, await res.clone().text());
  return await res.json() as T;
}

describe("orchestration REST", () => {
  it("bearer-token gate: 401 without or with the wrong token, 200 with the right one", async () => {
    Deno.env.set("ORCHESTRATION_TOKEN", "sekrit");

    assertEquals((await orchestrationApp.request("/boards")).status, 401);
    assertEquals((await orchestrationApp.request("/boards", { headers: { authorization: "Bearer wrong" } })).status, 401);
    assertEquals((await orchestrationApp.request("/boards", { headers: { authorization: "Bearer sekrit" } })).status, 200);
  });

  it("no token configured means the gate is open", async () => {
    assertEquals((await orchestrationApp.request("/boards")).status, 200);
  });

  it("unknown board slug 404s cleanly on every board-scoped route", async () => {
    const res = await orchestrationApp.request("/boards/nope-does-not-exist/cards");
    assertEquals(res.status, 404);
    assert((await res.text()).includes("unknown board"));
  });

  it("board create: 201, then 400 on a duplicate slug", async () => {
    const created = await mustJson<{ id: string; slug: string }>(
      await post("/boards", { slug: "rest-test", title: "REST test" }),
      201,
    );
    assertEquals(created.slug, "rest-test");

    const dup = await post("/boards", { slug: "rest-test", title: "again" });
    assertEquals(dup.status, 400);
  });

  it("card create: 400 (not 500) with the error text when dependsOn is unknown", async () => {
    await post("/boards", { slug: "rest-deps", title: "t" });
    const res = await post("/boards/rest-deps/cards", {
      title: "orphan",
      description: "x",
      dependsOn: ["01NOTREAL00000000000000000"],
    });
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "unknown dependsOn card(s): 01NOTREAL00000000000000000");
  });

  it("claim: 409 with a structured body for an unregistered agent, card untouched", async () => {
    await post("/boards", { slug: "rest-claim", title: "t" });
    const card = await mustJson<{ id: string }>(
      await post("/boards/rest-claim/cards", { title: "task", description: "x" }),
      201,
    );

    const res = await post(`/boards/rest-claim/cards/${card.id}/claim`, { agentId: "ghost" });
    const body = await mustJson<{ ok: boolean; message: string }>(res, 409);
    assertEquals(body.ok, false);
    assert(body.message.includes("register first"));

    const after = await mustJson<{ status: string }>(await orchestrationApp.request(`/boards/rest-claim/cards/${card.id}`), 200);
    assertEquals(after.status, "ready");
  });

  it("full worker lifecycle over REST: register, claim-next, progress, complete", async () => {
    await post("/boards", { slug: "rest-flow", title: "t" });
    const agent = await mustJson<{ id: string }>(
      await post("/boards/rest-flow/agents", { name: "rest-worker", role: "tester" }),
      201,
    );
    const card = await mustJson<{ id: string }>(
      await post("/boards/rest-flow/cards", { title: "task", description: "x" }),
      201,
    );

    const claimed = await mustJson<{ id: string; status: string }>(
      await post("/boards/rest-flow/claim-next", { agentId: agent.id }),
      200,
    );
    assertEquals(claimed.id, card.id);
    assertEquals(claimed.status, "in_progress");

    await mustJson(await post(`/boards/rest-flow/cards/${card.id}/progress`, { agentId: agent.id, note: "halfway" }), 200);
    const done = await mustJson<{ status: string; result: string }>(
      await post(`/boards/rest-flow/cards/${card.id}/complete`, { agentId: agent.id, result: "shipped", branch: "card/x" }),
      200,
    );
    assertEquals(done.status, "done");
    assertEquals(done.result, "shipped");

    // The whole story landed in the event log, newest last.
    const events = await mustJson<Array<{ type: string }>>(await orchestrationApp.request("/boards/rest-flow/events"), 200);
    const types = events.map((e) => e.type);
    for (const expected of ["agent.registered", "card.created", "card.claimed", "card.progress", "card.completed"]) {
      assert(types.includes(expected), `missing event ${expected}`);
    }
  });

  it("GET /events?since= returns only events after the cursor", async () => {
    await post("/boards", { slug: "rest-events", title: "t" });
    await post("/boards/rest-events/cards", { title: "one", description: "x" });
    const all = await mustJson<Array<{ id: string }>>(await orchestrationApp.request("/boards/rest-events/events"), 200);
    assert(all.length >= 1);

    await post("/boards/rest-events/cards", { title: "two", description: "x" });
    const since = await mustJson<Array<{ id: string }>>(
      await orchestrationApp.request(`/boards/rest-events/events?since=${all.at(-1)!.id}`),
      200,
    );
    assertEquals(since.length, 1);
  });
});

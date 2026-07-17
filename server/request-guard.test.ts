import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { Hono } from "jsr:@hono/hono";
import { requestGuard } from "./request-guard.ts";

function appWithGuard(configuredHost?: string): Hono {
  const app = new Hono();
  app.use("/api/*", requestGuard(configuredHost));
  app.post("/api/thing", (c) => c.text("ok"));
  return app;
}

async function status(app: Hono, url: string, headers: Record<string, string> = {}): Promise<number> {
  const res = await app.request(url, { method: "POST", headers });
  return res.status;
}

describe("requestGuard", () => {
  it("allows loopback requests with no Origin (curl, MCP clients, EventSource)", async () => {
    const app = appWithGuard();
    assertEquals(await status(app, "http://127.0.0.1:8000/api/thing"), 200);
    assertEquals(await status(app, "http://localhost:8000/api/thing"), 200);
    assertEquals(await status(app, "http://[::1]:8000/api/thing"), 200);
  });

  it("allows same-origin browser requests from the loopback frontend", async () => {
    const app = appWithGuard();
    assertEquals(await status(app, "http://localhost:8000/api/thing", { origin: "http://localhost:8000" }), 200);
    assertEquals(await status(app, "http://127.0.0.1:8000/api/thing", { origin: "http://127.0.0.1:8000" }), 200);
  });

  it("rejects a DNS-rebound Host", async () => {
    const app = appWithGuard();
    assertEquals(await status(app, "http://attacker.example:8000/api/thing"), 403);
  });

  it("rejects cross-site Origins, including opaque and malformed ones", async () => {
    const app = appWithGuard();
    const url = "http://127.0.0.1:8000/api/thing";
    assertEquals(await status(app, url, { origin: "https://evil.example" }), 403);
    assertEquals(await status(app, url, { origin: "null" }), 403);
    assertEquals(await status(app, url, { origin: "not a url" }), 403);
  });

  it("a deliberate SWITCHBOARD_HOST exposure admits its own remote frontend, still rejects cross-site", async () => {
    const app = appWithGuard("0.0.0.0");
    const url = "http://192.168.1.5:8000/api/thing";
    assertEquals(await status(app, url), 200);
    assertEquals(await status(app, url, { origin: "http://192.168.1.5:8000" }), 200);
    assertEquals(await status(app, url, { origin: "https://evil.example" }), 403);
  });

  it("a loopback SWITCHBOARD_HOST value keeps the strict loopback posture", async () => {
    const app = appWithGuard("127.0.0.1");
    assertEquals(await status(app, "http://attacker.example:8000/api/thing"), 403);
  });
});

import { Hono } from "jsr:@hono/hono";
import { serveStatic } from "jsr:@hono/hono/deno";
import { requestGuard } from "./server/request-guard.ts";
import { krakenApp } from "./server/kraken/routes.ts";
import { orchestrationApp } from "./server/orchestration/routes.ts";

// Resolved relative to this module's own location, not the process's cwd —
// a packaged .app launched via Finder/`open` gets an unrelated cwd, so a
// bare "dist" would never find the bundled frontend (only "worked" in dev
// because a loose dist/ happened to sit at the terminal's cwd).
const DIST_DIR = new URL("./dist", import.meta.url).pathname;

const app = new Hono();

// Rejects DNS-rebound Hosts and cross-site Origins — see request-guard.ts.
app.use("/api/*", requestGuard(Deno.env.get("KRAKEN_HOST")));

app.route("/api/kraken", krakenApp);
app.route("/api/orchestration", orchestrationApp);

app.use("*", serveStatic({ root: DIST_DIR }));
app.use("*", serveStatic({ path: `${DIST_DIR}/index.html` }));

// Loopback only by default: this API can spawn agent sessions with an
// arbitrary cwd and set the user's API key — Deno.serve's default of
// 0.0.0.0 would hand that to the whole LAN. KRAKEN_HOST exists for
// the rare deliberate override.
Deno.serve({ hostname: Deno.env.get("KRAKEN_HOST") ?? "127.0.0.1" }, app.fetch);

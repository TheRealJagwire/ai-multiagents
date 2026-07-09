import { Hono } from "jsr:@hono/hono";
import { serveStatic } from "jsr:@hono/hono/deno";
import { switchboardApp } from "./server/switchboard/routes.ts";

// Resolved relative to this module's own location, not the process's cwd —
// a packaged .app launched via Finder/`open` gets an unrelated cwd, so a
// bare "dist" would never find the bundled frontend (only "worked" in dev
// because a loose dist/ happened to sit at the terminal's cwd).
const DIST_DIR = new URL("./dist", import.meta.url).pathname;

const app = new Hono();

app.route("/api/switchboard", switchboardApp);

app.use("*", serveStatic({ root: DIST_DIR }));
app.use("*", serveStatic({ path: `${DIST_DIR}/index.html` }));

Deno.serve(app.fetch);

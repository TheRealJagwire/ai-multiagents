// The /api/* guard for main.ts. The API can approve gated tool calls, set
// API keys, and spawn sessions with an arbitrary cwd — binding to loopback
// keeps the LAN out, but not the user's own browser. Two header checks
// close that:
// - Host must be a loopback name, or a webpage the victim visits could
//   reach us through DNS rebinding (attacker.com resolving to 127.0.0.1).
//   Skipped when SWITCHBOARD_HOST deliberately exposes the server — then
//   clients legitimately connect via whatever name reaches that interface.
// - Origin, when a browser sends it, must be a loopback origin, or any
//   webpage could fire preflight-free cross-site POSTs (text/plain bodies
//   still parse as JSON) at state-changing endpoints. Non-browser clients
//   (curl, MCP SDKs, the desktop webview's own page) send no Origin and
//   pass untouched.

import type { MiddlewareHandler } from "jsr:@hono/hono";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function requestGuard(configuredHost: string | undefined): MiddlewareHandler {
  const loopbackOnly = !configuredHost || LOOPBACK_HOSTNAMES.has(configuredHost);

  return async (c, next) => {
    const requestHostname = new URL(c.req.url).hostname;
    if (loopbackOnly && !LOOPBACK_HOSTNAMES.has(requestHostname)) {
      return c.text("forbidden: non-loopback Host", 403);
    }
    // "null" (sandboxed iframes, file:// pages) is rejected along with
    // malformed values: the real frontend is served same-origin off this
    // very server (api.ts uses relative URLs), so its Origin is always this
    // server's own origin or absent. The requestHostname comparison keeps
    // the SWITCHBOARD_HOST exposure case working for its remote frontend.
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      let originHostname: string | null;
      try {
        originHostname = new URL(origin).hostname;
      } catch {
        originHostname = null;
      }
      if (originHostname === null || (!LOOPBACK_HOSTNAMES.has(originHostname) && originHostname !== requestHostname)) {
        return c.text("forbidden: cross-site request", 403);
      }
    }
    await next();
  };
}

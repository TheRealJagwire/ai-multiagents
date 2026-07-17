// Manual spike: verifies @google/adk works under Deno 2 before the ADK
// session driver was built on it (see adk-sessions.ts). Not a test file —
// run by hand:
//
//   deno run -A tools/adk-spike.ts            # offline structural checks
//   GEMINI_API_KEY=... deno run -A tools/adk-spike.ts   # + one live turn
//
// Kept around so a future @google/adk upgrade can be smoke-checked the
// same way.

import { FunctionTool, Gemini, InMemorySessionService, isFinalResponse, LlmAgent, MCPToolset, Runner } from "npm:@google/adk@^1.3.0";
import { z } from "npm:zod@^4.4.3";
import { fromFileUrl } from "jsr:@std/path";

const results: [string, boolean, string][] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// (b) FunctionTool with a zod schema constructs and declares correctly.
let toolCalled = false;
const echoTool = new FunctionTool({
  name: "echo",
  description: "Echoes the given text back.",
  parameters: z.object({ text: z.string().describe("Text to echo") }),
  execute: ({ text }) => {
    toolCalled = true;
    return { echoed: text };
  },
});
const declaration = echoTool._getDeclaration();
check("FunctionTool + zod v4 schema constructs", declaration.name === "echo" && !!declaration.parameters);

// (a) Core classes construct under Deno.
const sessionService = new InMemorySessionService();
const apiKey = Deno.env.get("GEMINI_API_KEY");
const makeAgent = (model: string) =>
  new LlmAgent({
    name: "spike_agent",
    // Explicit-apiKey path (GeminiParams.apiKey) — avoids relying on env
    // capture inside @google/genai.
    model: new Gemini({ model, ...(apiKey ? { apiKey } : {}) }),
    instruction: "You are a test agent. When asked to echo something, use the echo tool, then reply DONE.",
    tools: [echoTool],
  });
const makeRunner = (model: string) => new Runner({ appName: "spike", agent: makeAgent(model), sessionService });
check("LlmAgent + Gemini(model, apiKey) + Runner construct", true);

// (d, offline half) A session persists in the service across Runner instances.
const session = await sessionService.createSession({ appName: "spike", userId: "u1" });
const again = await sessionService.getSession({ appName: "spike", userId: "u1", sessionId: session.id });
check("InMemorySessionService round-trips a session", again?.id === session.id);

// (h) MCPToolset discovers tools from a child stdio MCP server under Deno.
// This is the load-bearing unknown for Step 4 (MCP for Gemini): if getTools()
// can't spawn the child and list its tools here, the whole approach needs a
// rethink. No Gemini key required — pure MCP client/server plumbing.
{
  const serverPath = fromFileUrl(new URL("./adk-spike-mcp-server.ts", import.meta.url));
  const toolset = new MCPToolset({
    type: "StdioConnectionParams",
    serverParams: { command: "deno", args: ["run", "-A", serverPath] },
  });
  try {
    const mcpTools = await toolset.getTools();
    check("MCPToolset discovers a stdio server's tools under Deno", mcpTools.some((t) => t.name === "ping"), mcpTools.map((t) => t.name).join(", "));
  } catch (err) {
    check("MCPToolset discovers a stdio server's tools under Deno", false, String(err));
  } finally {
    await toolset.close().catch(() => {});
  }
}

if (!apiKey) {
  console.log("\nGEMINI_API_KEY not set — skipping live-turn checks (tool round-trip, history across runners, usage metadata).");
} else {
  // (b live + e) One real turn: tool round-trip + usage metadata shape.
  const controller = new AbortController();
  let sawText = "";
  let sawFunctionCall = false;
  let sawUsage: unknown = null;
  for await (
    const event of makeRunner("gemini-flash-latest").runAsync({
      userId: "u1",
      sessionId: session.id,
      newMessage: { role: "user", parts: [{ text: "Echo the word 'kraken' using your tool." }] },
      abortSignal: controller.signal,
    })
  ) {
    for (const part of event.content?.parts ?? []) {
      if (part.text && !event.partial) sawText += part.text;
      if (part.functionCall) sawFunctionCall = true;
    }
    if (isFinalResponse(event) && event.usageMetadata) sawUsage = event.usageMetadata;
  }
  check("live turn: model called the zod tool", sawFunctionCall && toolCalled);
  check("live turn: final text received", sawText.length > 0, JSON.stringify(sawText.slice(0, 80)));
  check("live turn: usageMetadata present", sawUsage !== null, JSON.stringify(sawUsage));

  // (d live) Recreate the Runner (fresh LlmAgent, different model) over the
  // SAME service+sessionId — the model must still see the earlier exchange.
  let recallText = "";
  for await (
    const event of makeRunner("gemini-flash-latest").runAsync({
      userId: "u1",
      sessionId: session.id,
      newMessage: { role: "user", parts: [{ text: "What word did I ask you to echo earlier? Reply with just the word." }] },
    })
  ) {
    for (const part of event.content?.parts ?? []) {
      if (part.text && !event.partial) recallText += part.text;
    }
  }
  check("recreated Runner preserves history", recallText.toLowerCase().includes("kraken"), JSON.stringify(recallText.slice(0, 80)));

  // (g, live) Does generateContentConfig.thinkingConfig actually take effect,
  // or is it stripped (the "configure via planner" doc note)? Construct with
  // it (needs a key — the Gemini ctor throws without one) and run a turn with
  // thinking DISABLED; if honored, the final event's usageMetadata should
  // carry no (or zero) thoughtsTokenCount. Reported for a human to eyeball —
  // ADK may not surface thought tokens at all, so this is informational.
  try {
    const thinkingRunner = new Runner({
      appName: "spike",
      agent: new LlmAgent({
        name: "spike_thinking",
        model: new Gemini({ model: "gemini-flash-latest", apiKey }),
        instruction: "Answer in one word.",
        tools: [],
        generateContentConfig: { thinkingConfig: { thinkingBudget: 0 } },
      }),
      sessionService,
    });
    const s2 = await sessionService.createSession({ appName: "spike", userId: "u2" });
    let usage2: Record<string, unknown> | null = null;
    for await (
      const event of thinkingRunner.runAsync({
        userId: "u2",
        sessionId: s2.id,
        newMessage: { role: "user", parts: [{ text: "What is 2+2?" }] },
      })
    ) {
      if (isFinalResponse(event) && event.usageMetadata) usage2 = event.usageMetadata as Record<string, unknown>;
    }
    check("thinkingConfig turn completed (inspect usage for thought tokens)", usage2 !== null, JSON.stringify(usage2));
  } catch (err) {
    check("thinkingConfig turn completed (inspect usage for thought tokens)", false, String(err));
  }
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) Deno.exit(1);

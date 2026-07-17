// Driver-agnostic turn reporting, shared by both agent drivers
// (agent-sessions.ts for Claude, adk-sessions.ts for Gemini): collecting the
// final assistant message of a turn into a feed summary, and posting "plan"
// artifacts (from Claude's ExitPlanMode or a sequenced lead's
// SWITCHBOARD_TASKS.md). Everything here is pure state mutation — no SDK
// types on either side.

import { planBullets } from "../../src/switchboard/format.ts";
import { pushFeedEvent, pushTranscriptMessage } from "./mutations.ts";
import { state } from "./state.ts";
import { parseSpecFile } from "./team-spec.ts";
import { readSpecFile } from "./git-worktree.ts";

// Text from the most recent assistant message only (reset on every new
// assistant message, not accumulated across the whole turn) — the system
// prompt instructs the agent to make its final reply a concise summary, so
// capturing just that last message is what makes the posted summary
// actually concise instead of a dump of every intermediate narration line.
const turnText = new Map<string, string[]>();

export function beginAssistantMessage(sid: string): void {
  turnText.set(sid, []);
}

export function collectTurnText(sid: string, text: string): void {
  const existing = turnText.get(sid);
  if (existing) existing.push(text);
  else turnText.set(sid, [text]);
}

export function discardTurnText(sid: string): void {
  turnText.delete(sid);
}

const TURN_SUMMARY_LIMIT = 500;

// Posts the summary both to the feed (visible at a glance across all
// sessions) and into this session's own transcript (so it scrolls by inline
// with the rest of the live updates when you have the session open).
export function flushTurnSummary(sid: string): void {
  const blocks = turnText.get(sid);
  turnText.delete(sid);
  if (!blocks || blocks.length === 0) return;

  const text = blocks.join("\n\n").trim();
  if (!text) return;

  const body = text.length > TURN_SUMMARY_LIMIT ? `${text.slice(0, TURN_SUMMARY_LIMIT)}…` : text;
  pushTranscriptMessage(sid, { k: "summary", text: body });
  pushFeedEvent({ sid, kind: "message", own: false, verb: "responded", body });
}

const PLAN_PREVIEW_LINES = 6;

// A "plan" — whether Claude's own ExitPlanMode text or a sequenced-team
// lead's SWITCHBOARD_TASKS.md — always lands here: one bulleted card in the
// session's transcript, plus a feed "artifact" event so it also shows on
// that session's roster row (see latestPlanBySession in the frontend store)
// and the main dashboard feed.
export function recordPlan(sid: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  pushTranscriptMessage(sid, { k: "plan", text: trimmed });
  const bullets = planBullets(trimmed);
  pushFeedEvent({
    sid,
    kind: "artifact",
    own: false,
    verb: "proposed a plan",
    body: trimmed,
    artName: "Plan",
    artExt: "md",
    artPreview: bullets.slice(0, PLAN_PREVIEW_LINES).map((line) => [line, "n"] as [string, "n"]),
  });
}

// Sequenced-team leads write their plan to SWITCHBOARD_TASKS.md rather than
// calling ExitPlanMode — dedup by last-seen file content per session so a
// re-check after every successful turn doesn't re-post the same plan.
const seenSpecContent = new Map<string, string>();

export async function checkForSpecPlan(sid: string): Promise<void> {
  const session = state.sessions.find((s) => s.id === sid);
  if (!session?.lead || !session.teamId || !session.worktreePath) return;
  const team = state.teams.find((t) => t.id === session.teamId);
  if (team?.coordination !== "sequenced") return;

  const content = await readSpecFile(session.worktreePath);
  if (!content || seenSpecContent.get(sid) === content) return;
  seenSpecContent.set(sid, content);

  const tasks = parseSpecFile(content);
  if (tasks.length === 0) return;
  const text = tasks.map((t) => `${t.label ? `${t.label}: ` : ""}${t.task.replace(/\s+/g, " ")}`).join("\n");
  recordPlan(sid, text);
}

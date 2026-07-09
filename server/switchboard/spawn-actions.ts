import type { Effort, Model, Session } from "../../src/switchboard/types.ts";
import { nextId, state } from "./state.ts";
import { pushFeedEvent, pushSessionAdd, pushSessionPatch, pushTeamsReplace, pushTranscriptMessage } from "./mutations.ts";
import { spawnAgentSession } from "./agent-sessions.ts";
import { assertGitRepo, assertRefExists, branchName, createWorktree, worktreesBaseDir, worktreeSlug } from "./git-worktree.ts";
import { join } from "jsr:@std/path";

function startWorktreeAndSession(
  sid: string,
  dir: string,
  baseRef: string,
  task: string,
  model: Model,
  effort: Effort,
): void {
  const short = shortFrom(task);
  const branch = branchName(short, sid);
  const worktreePath = join(worktreesBaseDir(dir), worktreeSlug(short, sid));

  (async () => {
    await assertGitRepo(dir);
    await assertRefExists(dir, baseRef);

    pushSessionPatch(sid, { statusLine: "Creating worktree…" });
    await createWorktree(dir, baseRef, branch, worktreePath);
    pushSessionPatch(sid, { worktreePath, branch, statusLine: "Starting up…" });

    await spawnAgentSession(sid, task, { dir, worktreePath, branch, model, effort });
  })().catch((err) => {
    pushSessionPatch(sid, { status: "error", statusLine: "Failed to start", phase: "blocked" });
    pushFeedEvent({ sid, kind: "error", own: false, verb: `failed to start real session: ${String(err)}` });
  });
}

function shortFrom(text: string): string {
  const short = text
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 2)
    .join("-")
    .replace(/[^a-z0-9-]/g, "");
  return short || "new-agent";
}

function makeSession(
  id: string,
  task: string,
  opts: { teamId: string | null; lead: boolean; model: Model; effort: Effort; rolePrefix: string; dir: string },
): Session {
  const short = shortFrom(task);
  return {
    id,
    name: `${opts.rolePrefix}${short}`,
    short,
    baseName: short,
    teamId: opts.teamId,
    lead: opts.lead,
    status: "running",
    statusLine: "Starting up…",
    phase: "planning",
    msDone: 0,
    msTotal: 4,
    startedAt: Date.now(),
    cost: 0,
    model: opts.model,
    effort: opts.effort,
    ctx: 1,
    dep: "",
    pendingModel: null,
    pendingEffort: null,
    pendingMove: null,
    dir: opts.dir,
    worktreePath: null,
    branch: null,
  };
}

export function spawnSolo(task: string, model: Model, effort: Effort, dir: string, baseRef: string): void {
  const trimmedTask = task.trim() || "New task";
  const session = makeSession(nextId("s"), trimmedTask, { teamId: null, lead: false, model, effort, rolePrefix: "", dir });
  const displayName = trimmedTask.length > 26 ? `${trimmedTask.slice(0, 24)}…` : trimmedTask;
  session.name = displayName;
  session.baseName = displayName;

  pushSessionAdd(session);
  pushTranscriptMessage(session.id, { k: "note", text: `Task from you: ${trimmedTask}` });
  pushFeedEvent({ sid: session.id, kind: "info", own: true, verb: "spawned as independent session" });
  startWorktreeAndSession(session.id, dir, baseRef, trimmedTask, model, effort);
}

export function spawnIntoTeam(task: string, teamId: string, model: Model, effort: Effort): void {
  const team = state.teams.find((t) => t.id === teamId);
  const trimmedTask = task.trim() || "New task";
  const session = makeSession(nextId("s"), trimmedTask, {
    teamId,
    lead: false,
    model,
    effort,
    rolePrefix: "Worker · ",
    dir: team?.dir ?? "",
  });

  pushSessionAdd(session);
  pushTranscriptMessage(session.id, { k: "note", text: `Task from you: ${trimmedTask}` });
  pushFeedEvent({
    sid: session.id,
    kind: "info",
    own: true,
    verb: `spawned by you — joined ${team?.name ?? "team"}`,
  });

  if (!team) {
    pushSessionPatch(session.id, { status: "error", statusLine: "Unknown team", phase: "blocked" });
    pushFeedEvent({ sid: session.id, kind: "error", own: false, verb: "failed to start: unknown team" });
    return;
  }
  startWorktreeAndSession(session.id, team.dir, team.baseRef, trimmedTask, model, effort);
}

export function spawnTeam(
  name: string,
  goal: string,
  dir: string,
  baseRef: string,
  members: { task: string; model: Model; effort: Effort }[],
): void {
  const trimmedName = name.trim() || "New team";
  const trimmedGoal = goal.trim() || "No goal set yet.";
  const teamId = nextId("tm");
  const rows = members.length
    ? members
    : [
      { task: "", model: "opus" as Model, effort: "high" as Effort },
      { task: "", model: "sonnet" as Model, effort: "medium" as Effort },
    ];

  const tasks = rows.map((row, i) => row.task.trim() || (i === 0 ? "Coordinate the work" : `Task ${i + 1}`));
  const sessions: Session[] = rows.map((row, i) =>
    makeSession(nextId("s"), tasks[i], {
      teamId,
      lead: i === 0,
      model: row.model,
      effort: row.effort,
      rolePrefix: i === 0 ? "Lead · " : "Worker · ",
      dir,
    })
  );

  pushTeamsReplace([...state.teams, { id: teamId, name: trimmedName, goal: trimmedGoal, dir, baseRef, startedAt: Date.now() }]);
  for (const session of sessions) pushSessionAdd(session);

  sessions.forEach((session, i) => {
    if (i === 0) {
      pushTranscriptMessage(session.id, { k: "note", text: `Team goal: ${trimmedGoal}` });
      startWorktreeAndSession(session.id, dir, baseRef, `Team goal: ${trimmedGoal}. Your task: ${tasks[i]}`, session.model, session.effort);
    } else {
      pushTranscriptMessage(session.id, { k: "note", text: `Task from lead: ${tasks[i]}` });
      startWorktreeAndSession(
        session.id,
        dir,
        baseRef,
        `You're part of a team pursuing this goal: ${trimmedGoal}. Your task: ${tasks[i]}`,
        session.model,
        session.effort,
      );
    }
  });

  pushFeedEvent({
    sid: sessions[0].id,
    kind: "info",
    own: true,
    verb: `team "${trimmedName}" spawned by you — ${sessions.length} agents`,
  });
}

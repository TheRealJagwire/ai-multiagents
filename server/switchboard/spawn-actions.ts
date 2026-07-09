import type { Effort, Model, Session, TeamCoordination } from "../../src/switchboard/types.ts";
import { nextId, state } from "./state.ts";
import { pushFeedEvent, pushSessionAdd, pushSessionPatch, pushTeamsReplace, pushTranscriptMessage } from "./mutations.ts";
import { spawnAgentSession, type SpawnWorkerResult } from "./agent-sessions.ts";
import {
  assertGitRepo,
  assertRefExists,
  branchName,
  commitPendingChanges,
  createNewRepo,
  createWorktree,
  readSpecFile,
  SPEC_FILE_NAME,
  worktreesBaseDir,
  worktreeSlug,
} from "./git-worktree.ts";
import { parseSpecFile } from "./team-spec.ts";
import { join } from "jsr:@std/path";

function startWorktreeAndSession(
  sid: string,
  dir: string,
  baseRef: string,
  task: string,
  model: Model,
  effort: Effort,
  mcpConfigIds: string[],
  onSpawnWorker?: (task: string) => Promise<SpawnWorkerResult>,
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

    await spawnAgentSession(sid, task, { dir, worktreePath, branch, model, effort, mcpConfigIds, onSpawnWorker });
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
  opts: {
    teamId: string | null;
    lead: boolean;
    model: Model;
    effort: Effort;
    rolePrefix: string;
    dir: string;
    mcpConfigIds: string[];
  },
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
    mcpConfigIds: opts.mcpConfigIds,
  };
}

export function spawnSolo(
  task: string,
  model: Model,
  effort: Effort,
  dir: string,
  baseRef: string,
  createNew: boolean,
  mcpConfigIds: string[],
): void {
  const trimmedTask = task.trim() || "New task";
  const session = makeSession(nextId("s"), trimmedTask, {
    teamId: null,
    lead: false,
    model,
    effort,
    rolePrefix: "",
    dir,
    mcpConfigIds,
  });
  const displayName = trimmedTask.length > 26 ? `${trimmedTask.slice(0, 24)}…` : trimmedTask;
  session.name = displayName;
  session.baseName = displayName;

  pushSessionAdd(session);
  pushTranscriptMessage(session.id, { k: "note", text: `Task from you: ${trimmedTask}` });
  pushFeedEvent({ sid: session.id, kind: "info", own: true, verb: "spawned as independent session" });

  if (createNew) {
    pushSessionPatch(session.id, { statusLine: "Creating repository…" });
    createNewRepo(dir)
      .then(() => startWorktreeAndSession(session.id, dir, "HEAD", trimmedTask, model, effort, mcpConfigIds))
      .catch((err) => {
        pushSessionPatch(session.id, { status: "error", statusLine: "Failed to start", phase: "blocked" });
        pushFeedEvent({ sid: session.id, kind: "error", own: false, verb: `failed to create repository: ${String(err)}` });
      });
    return;
  }
  startWorktreeAndSession(session.id, dir, baseRef, trimmedTask, model, effort, mcpConfigIds);
}

export function spawnIntoTeam(
  task: string,
  teamId: string,
  model: Model,
  effort: Effort,
  baseRefOverride?: string,
): void {
  const team = state.teams.find((t) => t.id === teamId);
  const trimmedTask = task.trim() || "New task";
  const session = makeSession(nextId("s"), trimmedTask, {
    teamId,
    lead: false,
    model,
    effort,
    rolePrefix: "Worker · ",
    dir: team?.dir ?? "",
    mcpConfigIds: team?.mcpConfigIds ?? [],
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
  startWorktreeAndSession(
    session.id,
    team.dir,
    baseRefOverride ?? team.baseRef,
    trimmedTask,
    model,
    effort,
    team.mcpConfigIds,
  );
}

// Only ever handed to an "autonomous" team's lead (see spawnTeam) — regular
// workers never receive a spawn-worker capability, so only a lead can grow
// its own team. Capped so a lead can't runaway-spawn.
const MAX_AUTONOMOUS_WORKERS = 8;

function makeSpawnWorkerCallback(teamId: string): (task: string) => Promise<SpawnWorkerResult> {
  return async (task: string) => {
    const team = state.teams.find((t) => t.id === teamId);
    const lead = state.sessions.find((s) => s.teamId === teamId && s.lead);
    if (!team || !lead?.branch) return { ok: false, error: "team or lead not ready yet" };

    const workerCount = state.sessions.filter((s) => s.teamId === teamId && !s.lead).length;
    if (workerCount >= MAX_AUTONOMOUS_WORKERS) {
      return { ok: false, error: `worker limit reached (${MAX_AUTONOMOUS_WORKERS} max)` };
    }

    spawnIntoTeam(task, teamId, "sonnet", "medium", lead.branch);
    return { ok: true };
  };
}

const SEQUENCED_LEAD_SUFFIX = `

You are the lead of this team and no other members exist yet. Plan the work, then write a file named ` +
  `${SPEC_FILE_NAME} at the root of your working directory listing one task per teammate: each task starts ` +
  `with a "## " heading (a short label) followed by a clear, self-contained description of what that ` +
  `teammate should do. Commit the file. A human will review your plan and start the other teammates from ` +
  `it — you don't spawn them yourself.`;

const AUTONOMOUS_LEAD_SUFFIX = `

You are the lead of this team and no other members exist yet. You have a "spawn_worker" tool available — ` +
  `plan the work, then call it once per teammate you need, each with a clear, self-contained task ` +
  `description. Each worker gets its own git worktree branched from your current branch, so commit anything ` +
  `they'll need to see before spawning them.`;

export function spawnTeam(
  name: string,
  goal: string,
  dir: string,
  baseRef: string,
  createNew: boolean,
  coordination: TeamCoordination,
  mcpConfigIds: string[],
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

  // Sequenced/autonomous teams only ever spawn the lead at creation time —
  // any additional rows the client sent are ignored.
  const activeRows = coordination === "classic" ? rows : rows.slice(0, 1);

  const tasks = activeRows.map((row, i) => row.task.trim() || (i === 0 ? "Coordinate the work" : `Task ${i + 1}`));
  const sessions: Session[] = activeRows.map((row, i) =>
    makeSession(nextId("s"), tasks[i], {
      teamId,
      lead: i === 0,
      model: row.model,
      effort: row.effort,
      rolePrefix: i === 0 ? "Lead · " : "Worker · ",
      dir,
      mcpConfigIds,
    })
  );

  const effectiveBaseRef = createNew ? "HEAD" : baseRef;
  pushTeamsReplace([
    ...state.teams,
    {
      id: teamId,
      name: trimmedName,
      goal: trimmedGoal,
      dir,
      baseRef: effectiveBaseRef,
      startedAt: Date.now(),
      mcpConfigIds,
      coordination,
      workersStarted: false,
    },
  ]);
  for (const session of sessions) pushSessionAdd(session);

  sessions.forEach((session, i) => {
    pushTranscriptMessage(
      session.id,
      i === 0 ? { k: "note", text: `Team goal: ${trimmedGoal}` } : { k: "note", text: `Task from lead: ${tasks[i]}` },
    );
  });

  const onSpawnWorker = coordination === "autonomous" ? makeSpawnWorkerCallback(teamId) : undefined;

  // All members share one directory, so the repo (when created fresh) is
  // created exactly once, before any member's worktree — running each
  // member's own createNewRepo independently would race on the same path.
  const launchMembers = () => {
    sessions.forEach((session, i) => {
      let task = i === 0
        ? `Team goal: ${trimmedGoal}. Your task: ${tasks[i]}`
        : `You're part of a team pursuing this goal: ${trimmedGoal}. Your task: ${tasks[i]}`;
      if (i === 0 && coordination === "sequenced") task += SEQUENCED_LEAD_SUFFIX;
      if (i === 0 && coordination === "autonomous") task += AUTONOMOUS_LEAD_SUFFIX;
      startWorktreeAndSession(
        session.id,
        dir,
        effectiveBaseRef,
        task,
        session.model,
        session.effort,
        mcpConfigIds,
        i === 0 ? onSpawnWorker : undefined,
      );
    });
  };

  if (createNew) {
    for (const session of sessions) pushSessionPatch(session.id, { statusLine: "Creating repository…" });
    createNewRepo(dir).then(launchMembers).catch((err) => {
      for (const session of sessions) {
        pushSessionPatch(session.id, { status: "error", statusLine: "Failed to start", phase: "blocked" });
        pushFeedEvent({ sid: session.id, kind: "error", own: false, verb: `failed to create repository: ${String(err)}` });
      }
    });
  } else {
    launchMembers();
  }

  pushFeedEvent({
    sid: sessions[0].id,
    kind: "info",
    own: true,
    verb: coordination === "classic"
      ? `team "${trimmedName}" spawned by you — ${sessions.length} agents`
      : `team "${trimmedName}" spawned by you — lead only (${coordination})`,
  });
}

// Sequenced mode: reads the lead's SWITCHBOARD_TASKS.md and spawns one
// worker per parsed task, each worktree branched off the lead's branch (not
// the team's original base ref) so workers see whatever the lead committed.
export function startWorkers(teamId: string): void {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team || team.coordination !== "sequenced" || team.workersStarted) return;

  const lead = state.sessions.find((s) => s.teamId === teamId && s.lead);
  if (!lead?.worktreePath || !lead.branch) {
    pushFeedEvent({
      sid: lead?.id ?? teamId,
      kind: "error",
      own: false,
      verb: "can't start workers yet — the lead hasn't finished starting up",
    });
    return;
  }
  const leadWorktreePath = lead.worktreePath;
  const leadBranch = lead.branch;
  const leadId = lead.id;

  (async () => {
    await commitPendingChanges(leadWorktreePath, "Pre-worker-spawn checkpoint");
    const content = await readSpecFile(leadWorktreePath);
    if (!content) {
      pushFeedEvent({
        sid: leadId,
        kind: "error",
        own: false,
        verb: `no ${SPEC_FILE_NAME} found in the lead's worktree yet — ask it to write one, then try again`,
      });
      return;
    }

    const specTasks = parseSpecFile(content);
    if (specTasks.length === 0) {
      pushFeedEvent({ sid: leadId, kind: "error", own: false, verb: `${SPEC_FILE_NAME} has no "## " task sections` });
      return;
    }

    pushTeamsReplace(state.teams.map((t) => (t.id === teamId ? { ...t, workersStarted: true } : t)));
    for (const specTask of specTasks) {
      spawnIntoTeam(specTask.task, teamId, "sonnet", "medium", leadBranch);
    }
    pushFeedEvent({
      sid: leadId,
      kind: "info",
      own: true,
      verb: `started ${specTasks.length} worker${specTasks.length === 1 ? "" : "s"} from the plan`,
    });
  })().catch((err) => {
    pushFeedEvent({ sid: leadId, kind: "error", own: false, verb: `failed to start workers: ${String(err)}` });
  });
}

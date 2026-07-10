// Wraps `git worktree` so every session/team-member gets an isolated
// checkout instead of sharing (and clobbering) one working directory.

import { dirname, basename, join } from "jsr:@std/path";

async function runGit(args: string[], cwd?: string): Promise<string> {
  const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(stderr).trim()}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

async function assertDirStat(dir: string): Promise<void> {
  if (!dir || !dir.startsWith("/")) {
    throw new Error(`directory must be an absolute path: "${dir}"`);
  }
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(dir);
  } catch {
    throw new Error(`directory does not exist: ${dir}`);
  }
  if (!stat.isDirectory) throw new Error(`not a directory: ${dir}`);
}

// Used by the "skip git" spawn path, where a session runs directly in `dir`
// with no worktree — the directory still has to exist, it just doesn't have
// to be a git repo.
export async function assertDirExists(dir: string): Promise<void> {
  await assertDirStat(dir);
}

export async function assertGitRepo(dir: string): Promise<void> {
  await assertDirStat(dir);
  const inside = await runGit(["-C", dir, "rev-parse", "--is-inside-work-tree"], dir).catch(() => "");
  if (inside !== "true") throw new Error(`not a git repository: ${dir}`);
}

export async function assertRefExists(dir: string, ref: string): Promise<void> {
  await runGit(["-C", dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], dir).catch(() => {
    throw new Error(`unknown ref "${ref}" in ${dir}`);
  });
}

// Creates the directory (must not already exist, or must be empty — this
// never git-inits over a directory that already has content), initializes a
// repo in it, and makes a first commit so `HEAD` resolves to a real commit —
// worktrees can't branch off an unborn HEAD. The commit is attributed to
// "Switchboard" rather than the host user's own git identity, since it's
// machine-generated scaffolding, not something the user authored.
export async function createNewRepo(dir: string): Promise<void> {
  if (!dir || !dir.startsWith("/")) {
    throw new Error(`directory must be an absolute path: "${dir}"`);
  }

  try {
    const stat = await Deno.stat(dir);
    if (!stat.isDirectory) throw new Error(`not a directory: ${dir}`);
    for await (const _entry of Deno.readDir(dir)) {
      throw new Error(`directory already exists and is not empty: ${dir}`);
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }

  await Deno.mkdir(dir, { recursive: true });
  await runGit(["init", dir]);
  await runGit(["-C", dir, "config", "user.name", "Switchboard"], dir);
  await runGit(["-C", dir, "config", "user.email", "switchboard@localhost"], dir);
  await Deno.writeTextFile(join(dir, "README.md"), `# ${basename(dir)}\n`);
  await runGit(["-C", dir, "add", "README.md"], dir);
  await runGit(["-C", dir, "commit", "-m", "Initial commit"], dir);
}

// Worktrees live next to the repo, not inside it — this repo's own
// .gitignore never needs to know about them, and `cd ..` from the repo
// finds every session's checkout.
export function worktreesBaseDir(dir: string): string {
  return join(dirname(dir), `${basename(dir)}-worktrees`);
}

export function worktreeSlug(taskSlug: string, sessionId: string): string {
  return `${taskSlug}-${sessionId}`;
}

export function branchName(taskSlug: string, sessionId: string): string {
  return `switchboard/${taskSlug}-${sessionId}`;
}

export async function createWorktree(
  dir: string,
  ref: string,
  branch: string,
  worktreePath: string,
): Promise<void> {
  await Deno.mkdir(worktreesBaseDir(dir), { recursive: true });
  await runGit(["-C", dir, "worktree", "add", "-b", branch, worktreePath, ref], dir);
}

// Commits anything uncommitted in a worktree so a later operation that reads
// or branches off it (removal, or spawning workers off this branch) never
// silently misses in-progress work. `--no-verify` so a pre-commit hook in
// the target repo can't block it.
export async function commitPendingChanges(worktreePath: string, message: string): Promise<void> {
  const dirty = await runGit(["status", "--porcelain"], worktreePath).catch(() => "");
  if (!dirty) return;
  await runGit(["add", "-A"], worktreePath);
  await runGit(["commit", "--no-verify", "-m", message], worktreePath);
}

// Auto-removes the worktree but never the branch — any uncommitted work
// gets a WIP commit first so cleanup can never silently discard it.
export async function removeWorktree(dir: string, worktreePath: string): Promise<void> {
  await commitPendingChanges(worktreePath, "WIP: auto-saved by Switchboard before worktree removal");
  await runGit(["-C", dir, "worktree", "remove", worktreePath, "--force"], dir);
}

// The file a "sequenced"-mode lead is instructed to write, listing one task
// per teammate — see team-spec.ts for the format it's parsed with.
export const SPEC_FILE_NAME = "SWITCHBOARD_TASKS.md";

export async function readSpecFile(worktreePath: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(join(worktreePath, SPEC_FILE_NAME));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

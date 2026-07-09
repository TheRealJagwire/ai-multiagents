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

export async function assertGitRepo(dir: string): Promise<void> {
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

  const inside = await runGit(["-C", dir, "rev-parse", "--is-inside-work-tree"], dir).catch(() => "");
  if (inside !== "true") throw new Error(`not a git repository: ${dir}`);
}

export async function assertRefExists(dir: string, ref: string): Promise<void> {
  await runGit(["-C", dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], dir).catch(() => {
    throw new Error(`unknown ref "${ref}" in ${dir}`);
  });
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

// Auto-removes the worktree but never the branch — any uncommitted work
// gets a WIP commit first so cleanup can never silently discard it.
export async function removeWorktree(dir: string, worktreePath: string): Promise<void> {
  const dirty = await runGit(["status", "--porcelain"], worktreePath).catch(() => "");
  if (dirty) {
    await runGit(["add", "-A"], worktreePath);
    await runGit(
      ["commit", "--no-verify", "-m", "WIP: auto-saved by Switchboard before worktree removal"],
      worktreePath,
    );
  }
  await runGit(["-C", dir, "worktree", "remove", worktreePath, "--force"], dir);
}

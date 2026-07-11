#!/usr/bin/env bash
# Launch one headless board worker (plan section 7, "Headless workers").
#
#   tools/spawn-worker.sh <name> [role] [board-slug]
#
# AGENT_BOARD activates the board-hook.ts lifecycle hooks for this session;
# the hooks register the worker and inject its agent_id, so the prompt only
# has to point at the protocol. Requires the daemon running on :8000
# (deno run -A main.ts).
set -euo pipefail

NAME="${1:?usage: spawn-worker.sh <name> [role] [board-slug]}"
ROLE="${2:-worker}"
BOARD="${3:-ai-multiagents}"

cd "$(dirname "$0")/.."
mkdir -p ../wt

# --mcp-config: headless -p doesn't auto-trust a project .mcp.json, so pass
# it explicitly. --add-dir: card worktrees live outside the repo checkout.
AGENT_BOARD="$BOARD" BOARD_AGENT_NAME="$NAME" BOARD_AGENT_ROLE="$ROLE" \
exec claude -p "You are $NAME, a $ROLE on board '$BOARD'. Follow the Board worker protocol in CLAUDE.md: register, claim cards, work each to completion in its own worktree, repeat until nothing is eligible, then stop." \
  --mcp-config .mcp.json \
  --add-dir ../wt \
  --allowedTools "mcp__board,Read,Glob,Grep,Edit,Write,Bash(git *),Bash(deno *)" \
  --output-format stream-json --verbose

#!/usr/bin/env bash
#
# rc-keepalive.sh — keep one Remote Control session alive, so the phone always
# has something to talk to.
#
# If tmux session `suite` exists, do nothing. If it does not, start it detached,
# running Claude Code with Remote Control on, in its own worktree.
#
# Its own worktree, not ~/portal. The 03:00 run checks out main and makes
# branches in ~/portal and refuses to start on a dirty tree (exit 64); an
# interactive session in the same checkout breaks it with uncommitted edits, and
# is broken by it when the branch moves underneath. A worktree shares the
# repository but not the working tree, the index or HEAD.
#
# One thing a worktree does not isolate: git refuses to check out a branch that
# another worktree has checked out. The RC worktree parks on
# overnight/rc-desk and must never check out main, or the 03:00 run's
# `git checkout main` fails with exit 78.
#
# Started by uk.poweranalytix.portal.rc every 10 minutes and at load. Checking
# costs one `tmux has-session`; starting only happens after a restart, a crash,
# or somebody typing /exit.
#
# Exit codes, same vocabulary as overnight.sh:
#   0   the session was already there, or has just been started
#   78  a prerequisite is missing (tmux, claude, or the worktree)

set -euo pipefail

SESSION="${RC_TMUX_SESSION:-suite}"
WORKTREE="${RC_WORKTREE:-$HOME/portal-rc}"
REPO="${PORTAL_REPO:-/Users/wesleyhughes/portal}"
BRANCH="${RC_BRANCH:-overnight/rc-desk}"
NAME="${RC_NAME:-Power Suite}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fatal() { local code="$1"; shift; log "FATAL($code): $*"; exit "$code"; }

command -v tmux >/dev/null 2>&1 || fatal 78 "tmux is not on PATH — brew install tmux"
command -v "$CLAUDE_BIN" >/dev/null 2>&1 || fatal 78 "$CLAUDE_BIN is not on PATH"

# The common case, and silent: a log line every ten minutes saying nothing
# happened would bury the lines that matter.
tmux has-session -t "=$SESSION" 2>/dev/null && exit 0

# The worktree is made once, by a person, with the line in docs/OPERATIONS.md.
# Creating it here would mean a launchd job running `git worktree add` against
# the checkout the 03:00 run owns, at a time nobody chose.
[ -d "$WORKTREE" ] || fatal 78 "$WORKTREE does not exist — git -C $REPO worktree add $WORKTREE -b $BRANCH origin/main"

HERE="$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
[ "$HERE" = "main" ] && fatal 78 "$WORKTREE has main checked out, which would stop the 03:00 run checking it out — switch it to $BRANCH"

# `exec` so the pane's process IS claude: when it exits, the tmux session ends
# and the next fire starts a fresh one, rather than leaving a shell nobody is
# attached to.
tmux new-session -d -s "$SESSION" -c "$WORKTREE" \
  "exec $CLAUDE_BIN --remote-control \"$NAME\" --name \"$NAME\""
log "started tmux session $SESSION in $WORKTREE ($HERE): $CLAUDE_BIN --remote-control \"$NAME\""

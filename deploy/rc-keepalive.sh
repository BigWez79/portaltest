#!/usr/bin/env bash
#
# rc-keepalive.sh — keep one Remote Control session alive, so the Mac Studio is
# reachable from a phone without anybody leaving a Terminal window open.
#
# Started every ten minutes by uk.poweranalytix.portal.rc. If the tmux session
# `suite` exists it does nothing. If it does not — after a restart, a crash, or
# somebody typing `exit` — it starts it again, detached.
#
# It runs in its OWN worktree, ~/portal-rc on the branch rc/desk, never in
# ~/portal. That checkout belongs to the 03:00 build: an interactive session's
# uncommitted edits there make the build refuse to start (exit 64), and the
# build switches branches underneath the session. Two checkouts, no contention.
#
# It creates nothing it cannot recreate, and it never kills anything. A session
# that exists is left alone even if it looks stuck: whether to end it is a
# person's decision, made with `tmux kill-session -t suite`.
#
# Exit codes, for the log read the morning after:
#   0   the session was already running, or was started
#   78  a prerequisite is missing (tmux, claude, or the worktree)

set -euo pipefail

SESSION="${RC_TMUX_SESSION:-suite}"
WORKTREE="${RC_WORKTREE:-/Users/wesleyhughes/portal-rc}"
NAME="${RC_NAME:-Power Suite}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

command -v tmux >/dev/null 2>&1 || { log "FATAL: tmux is not on PATH — brew install tmux"; exit 78; }
command -v "$CLAUDE_BIN" >/dev/null 2>&1 || { log "FATAL: $CLAUDE_BIN is not on PATH — the plist sets PATH explicitly; check ~/.local/bin"; exit 78; }

# Not created here. Making a worktree is a git operation on ~/portal, and a job
# that runs every ten minutes has no business doing one of those unattended.
[ -d "$WORKTREE" ] || {
  log "FATAL: $WORKTREE does not exist — create it once: git -C ~/portal worktree add $WORKTREE -b rc/desk origin/main"
  exit 78
}

if tmux has-session -t "=$SESSION" 2>/dev/null; then
  exit 0
fi

# Remote Control needs a claude.ai subscription login, not an API key. launchd
# does not pass one, but a login shell might, and claude prefers the variable.
unset ANTHROPIC_API_KEY

tmux new-session -d -s "$SESSION" -c "$WORKTREE" \
  "$CLAUDE_BIN" --remote-control "$NAME" --name "$NAME"
log "started tmux session $SESSION: $CLAUDE_BIN --remote-control \"$NAME\" in $WORKTREE"

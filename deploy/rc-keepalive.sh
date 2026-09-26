#!/usr/bin/env bash
#
# rc-keepalive.sh — keep one Remote Control session alive, somewhere it cannot
# collide with the 03:00 build.
#
# Started every ten minutes by uk.poweranalytix.portal.rc. If the tmux session
# `suite` exists it does nothing and says nothing; if it does not, it starts it
# detached, running `claude --remote-control "Power Suite"` in ~/portal-rc.
#
# Why a worktree and not ~/portal. The overnight runner needs ~/portal clean and
# on main: an interactive session's uncommitted edit makes it refuse to start
# (exit 64), and the runner checking out main and an overnight/* branch moves
# the files out from under a session working there. ~/portal-rc is a separate
# git worktree on its own branch (rc/desk), so neither can see the other's tree.
# deploy/install.sh creates it.
#
# Why tmux. A session started in a Terminal window dies with the window. One
# started inside a detached tmux server does not, and launchd re-creating it
# every ten minutes covers a crash, a `/exit`, and a restart once someone has
# logged in. `tmux attach -t suite` puts it back on a screen.
#
# What it cannot cover: a LaunchAgent runs only once a person has logged in, and
# with FileVault on, a power cut means nothing runs until someone types the
# password at the Mac. See docs/OPERATIONS.md, "Staying alive".
#
# Exit codes: 0 already running, or started · 78 a prerequisite is missing.

set -euo pipefail

SESSION="${RC_TMUX_SESSION:-suite}"
WORKTREE="${RC_WORKTREE:-$HOME/portal-rc}"
REPO="${PORTAL_REPO:-/Users/wesleyhughes/portal}"
NAME="${RC_NAME:-Power Suite}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

command -v tmux >/dev/null 2>&1 || { log "FATAL: tmux is not on PATH — brew install tmux"; exit 78; }

# The common case, every ten minutes: nothing to do, and nothing to log.
tmux has-session -t "=$SESSION" 2>/dev/null && exit 0

command -v "$CLAUDE_BIN" >/dev/null 2>&1 || { log "FATAL: $CLAUDE_BIN is not on PATH — the plist sets PATH explicitly; check it"; exit 78; }
[ -d "$WORKTREE" ] || { log "FATAL: $WORKTREE does not exist — re-run deploy/install.sh, which creates it"; exit 78; }

# The whole point is not to share the build's checkout. Refuse rather than
# quietly start a session there because an override pointed at it.
here="$(cd "$WORKTREE" && pwd -P)"
build="$(cd "$REPO" 2>/dev/null && pwd -P || true)"
[ "$here" != "$build" ] || { log "FATAL: $WORKTREE is the build's checkout ($REPO) — the session must not run there"; exit 78; }
branch="$(git -C "$WORKTREE" branch --show-current 2>/dev/null || true)"
[ "$branch" != "main" ] || { log "FATAL: $WORKTREE is on main — the session belongs on its own branch"; exit 78; }

tmux new-session -d -s "$SESSION" -c "$WORKTREE" "$CLAUDE_BIN" --remote-control "$NAME"
log "started tmux session '$SESSION': $CLAUDE_BIN --remote-control \"$NAME\" in $WORKTREE (${branch:-detached})"

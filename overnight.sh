#!/usr/bin/env bash
#
# overnight.sh — one task from TASKS.md, one branch, one pull request.
#
# Started by uk.poweranalytix.portal.overnight at 03:00. The plist runs the
# INSTALLED copy at ~/.local/libexec/poweranalytix/overnight.sh with the working
# directory set to the repo, so this file operates on a checkout it does not
# live in. Edit here, then re-run deploy/install.sh, or the scheduled run keeps
# using the old copy.
#
# It does not source deploy/env-lib.sh. That library exists to read .env.local,
# and the whole point of this job is that it holds no Supabase credential — a
# dependency on the credential reader is the wrong shape even when unused. The
# eight lines of log() are cheaper than the confusion.
#
# What it will not do, and why the operator can leave it alone:
#
#   - It never pushes to main and never merges. It pushes an overnight/* branch
#     and opens a pull request. BLOCKED.md, "Release".
#   - This SCRIPT never applies a migration: it contains no `supabase db push`
#     call, and OVERNIGHT_APPLY_MIGRATIONS=0 arrives from the plist besides.
#     That constrains the script. It does NOT constrain the agent running
#     inside it, which has a shell, --dangerously-skip-permissions, and can
#     reach the CLI — whose token is in the login keychain, not in any
#     environment variable this file withholds. What actually stands in the way
#     is the prompt telling it not to, BLOCKED.md, and macOS asking a person for
#     a keychain password. None of those is structural. On 2026-09-03 a keychain
#     prompt for "Supabase CLI" appeared on this Mac, which is what that risk
#     looks like when it surfaces.
#   - It refuses to start on a dirty tree, mid-rebase, or behind a stale lock,
#     rather than committing somebody's half-finished work into a branch nobody
#     is expecting.
#
# Exit codes are distinct on purpose, because the only person reading them is
# reading a log the morning after:
#
#   0   a pull request was opened, or the queue was empty and nothing was due
#   64  the working tree was dirty
#   65  a rebase, merge or cherry-pick was already in progress
#   66  another run still had the lock
#   69  the task was done but `npm run verify` failed — a DRAFT pull request
#       was opened so the work is not lost
#   70  the headless run itself failed or timed out
#   78  a prerequisite is missing (a command, the repo, TASKS.md)

set -euo pipefail

# --------------------------------------------------------------------------
# Where things are. All absolute, all hard-coded to this machine, for the same
# reason the plists are: launchd starts from a near-empty environment and there
# is no login file to lean on.
# --------------------------------------------------------------------------
REPO="${PORTAL_REPO:-/Users/wesleyhughes/portal}"
LOCK_DIR="${PORTAL_LOCK_DIR:-$HOME/Library/Caches/uk.poweranalytix.portal.overnight.lock}"
# NOT $REPO/agent_logs. That directory is only in .gitignore on branches
# carrying PR #3, and this run checks out main, where it is not. Logs written
# before the checkout become untracked files after it -- and the sweep below
# would then commit a night of agent transcripts into a public repository.
# Outside the tree there is no branch whose .gitignore has to be right.
LOG_DIR="${PORTAL_LOG_DIR:-$HOME/Library/Logs/PowerAnalytix}"

# The one line most likely to need adjusting on first run. i-love-isle-of-wight's
# runner is the proven model and this was written without it in front of me, so
# if the first night fails at the headless step, compare this invocation with
# that one before changing anything else.
#
# --dangerously-skip-permissions is what makes it headless: the run has to be
# able to edit files and make git commits with nobody at the keyboard, and any
# permission prompt is a job that hangs until launchd's next fire. What bounds
# it is not the flag, it is everything around it — no Supabase variables in the
# environment, no push to main, no merge, a hard timeout, and a tree that must
# be clean before it starts.
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
CLAUDE_ARGS=(-p --output-format text --dangerously-skip-permissions)

# A run that has not finished in this long is not going to. 80 minutes for the
# agent, 25 for verify — the suite alone is 64 tests across four widths, and a
# cold `next build` before it.
# --dry-run does everything a real night does except the work: preflight, the
# fetch, the checkout, the branch, the ignore checks, and a two-second probe of
# the claude CLI to prove the headless invocation actually answers. It writes no
# code, pushes nothing, opens no pull request, and puts the checkout back on the
# branch it found. It exists because the alternative way to find out whether
# tonight will work is to let tonight happen.
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

CLAUDE_TIMEOUT="${CLAUDE_TIMEOUT:-4800}"
VERIFY_TIMEOUT="${VERIFY_TIMEOUT:-1500}"

# --------------------------------------------------------------------------
# Never run out of the repo, even when invoked from it.
#
# This script checks out main. If it is executing from $REPO/overnight.sh, git
# deletes and rewrites that path mid-run, and bash carries on reading whatever
# now sits at the offset it had reached -- which is not a crash, it is a shell
# executing arbitrary fragments of another branch's file. The installed copy at
# ~/.local/libexec is immune, and is what launchd runs; this is for the person
# who quite reasonably types ./overnight.sh to try it.
#
# The copy lives at a fixed path and is overwritten each time rather than being
# a mktemp, so trying this daily leaves one file rather than a directory full.
# --------------------------------------------------------------------------
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
if [ "${PORTAL_REEXEC:-0}" != "1" ]; then
  case "$SELF" in
    "$REPO"/*)
      RUNNING_COPY="$HOME/Library/Caches/uk.poweranalytix.portal.overnight.running.sh"
      mkdir -p "$(dirname "$RUNNING_COPY")"
      cat "$SELF" >"$RUNNING_COPY" || { echo "could not copy $SELF aside" >&2; exit 78; }
      chmod 0755 "$RUNNING_COPY"
      echo "running from $RUNNING_COPY, because $SELF is inside the checkout this run will move"
      PORTAL_REEXEC=1 exec "$RUNNING_COPY" "$@"
      ;;
  esac
fi

STAMP="$(date '+%Y-%m-%d')"
RUN_LOG="$LOG_DIR/overnight-$STAMP.log"

# --------------------------------------------------------------------------
# Logging. Everything goes to stdout, which launchd captures into
# overnight.out.log, and to a dated file beside it. Both live outside the
# checkout, for the reason given at LOG_DIR.
# --------------------------------------------------------------------------
log() {
  local line
  line="$(printf '[%s] %s' "$(date '+%Y-%m-%d %H:%M:%S')" "$*")"
  printf '%s\n' "$line"
  [ -d "$LOG_DIR" ] && printf '%s\n' "$line" >>"$RUN_LOG" || true
}

fatal() { local code="$1"; shift; log "FATAL($code): $*"; exit "$code"; }

# run_limited SECONDS CMD... — macOS has no timeout(1) unless coreutils is
# installed, and depending on a brew package for the thing that stops a runaway
# job is backwards. TERM first, KILL twenty seconds later.
run_limited() {
  local limit="$1"; shift
  local pid watcher rc=0
  "$@" & pid=$!
  ( sleep "$limit"; kill -TERM "$pid" 2>/dev/null; sleep 20; kill -KILL "$pid" 2>/dev/null ) &
  watcher=$!
  wait "$pid" || rc=$?
  kill -TERM "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  return "$rc"
}

# --------------------------------------------------------------------------
# One run at a time. mkdir is atomic; a lock FILE tested with -e is not, and
# two launchd fires a second apart is exactly the race that finds it. The PID
# inside lets a lock left by a crashed run be reclaimed instead of blocking
# every night until somebody notices.
# --------------------------------------------------------------------------
claim_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s' "$$" >"$LOCK_DIR/pid"
    return 0
  fi
  local old
  old="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    fatal 66 "another run (pid $old) still holds $LOCK_DIR"
  fi
  log "reclaiming a lock left by pid ${old:-unknown}, which is not running"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || fatal 66 "could not take $LOCK_DIR"
  printf '%s' "$$" >"$LOCK_DIR/pid"
}

release_lock() { rm -rf "$LOCK_DIR" 2>/dev/null || true; }

# Leave the tree as the next run needs to find it. Every exit matters, not just
# the good one: a run that dies after the agent has written files leaves them
# behind, and a dirty tree is precisely what aborts tomorrow night -- so a bad
# night would quietly cost two. Runs from the EXIT trap, so it must never call
# fatal and never assume where it is.
# Set only once this run has made its own branch. Before that, every file in
# the tree belongs to somebody else -- and the trap is installed BEFORE the
# dirty-tree check, so without this a run that correctly refused to start on
# your uncommitted work would have committed it on the way out. That is the
# opposite of the guard it was defending.
OWNS_BRANCH=0

# --------------------------------------------------------------------------
# One guard, used by both places that decide whether `git add -A` is safe.
#
# Both used to grep the porcelain status for `\.env|\.log|agent_logs/`, which
# catches the shapes somebody happened to think of. A credential in
# credentials.json, service-account.pem or keys.ts went straight through into a
# public repository (BLOCKED.md: both are public). A guard that only recognises
# the leaks you already imagined is the check rule 12 warns about — it passes
# while the thing it checks is broken.
#
# Contents are scanned for UNTRACKED files only, and that is deliberate:
#
#   - a tracked file's contents are already committed, so scanning them decides
#     nothing that has not already been decided;
#   - src/lib/supabase/server.ts and playwright.config.ts both legitimately
#     contain credential-shaped words, so content-scanning modified files would
#     halt the run every time either changed. A guard that stops every night
#     gets disabled, and a disabled guard is worse than none.
#
# Over-matching a filename costs a run that stops for a person to look at.
# Under-matching costs a key in a public repository. The asymmetry is the design.
# --------------------------------------------------------------------------
looks_like_a_secret() {
  local status_lines="$1" path
  # Matched against the whole status line rather than a parsed field: a filename
  # with a space in it would defeat the parse, and stopping too often is the
  # cheap direction to be wrong in.
  if printf '%s\n' "$status_lines" | grep -Eqi '\.env|\.log|agent_logs/|\.pem|\.p12|\.key|id_rsa|credential|secret|token'; then
    return 0
  fi
  # Untracked files only; `git status --porcelain` marks them '??'.
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    [ -f "$path" ] || continue
    [ "$(wc -c <"$path" 2>/dev/null || echo 0)" -lt 1048576 ] || continue
    grep -Iq . "$path" 2>/dev/null || continue   # skip binaries
    if grep -Eq 'BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\.|sk_live_|re_[A-Za-z0-9]{16,}' "$path" 2>/dev/null; then
      return 0
    fi
  done <<EOF
$(printf '%s\n' "$status_lines" | sed -n 's/^?? //p')
EOF
  return 1
}

tidy_tree() {
  [ "$OWNS_BRANCH" = "1" ] || return 0
  cd "$REPO" 2>/dev/null || return 0
  local left here
  left="$(git status --porcelain 2>/dev/null || true)"
  if [ -n "$left" ]; then
    here="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    case "$here" in
      "$BRANCH")
        if looks_like_a_secret "$left"; then
          log "leaving the tree dirty deliberately: something in it must not be committed"
          printf '%s\n' "$left" | sed 's/^/    /'
          return 0
        fi
        log "committing what the run left behind, so tomorrow night can start"
        git add -A >/dev/null 2>&1 || true
        git commit -q -m "overnight: leftovers from an incomplete run" >/dev/null 2>&1 || true
        ;;
      *)
        log "tree is dirty on $here, which is not the branch this run made -- not touching it"
        return 0
        ;;
    esac
  fi
  git checkout main >/dev/null 2>&1 || true
}

# --------------------------------------------------------------------------
# Preflight. Every one of these is a night that was lost once, somewhere.
# --------------------------------------------------------------------------
cd "$REPO" 2>/dev/null || fatal 78 "$REPO is not there"
mkdir -p "$LOG_DIR"
log "=== overnight run starting in $REPO ==="

for cmd in git node npm gh "$CLAUDE_BIN"; do
  command -v "$cmd" >/dev/null 2>&1 || fatal 78 "$cmd is not on PATH — launchd starts with almost none, so the plist sets it explicitly"
done
[ -f TASKS.md ] || fatal 78 "no TASKS.md in $REPO"
[ -f CLAUDE.md ] || fatal 78 "no CLAUDE.md in $REPO"

claim_lock
trap 'tidy_tree; release_lock' EXIT

# A lock left by a crashed git is not the same as a run in progress, and it
# blocks everything downstream with a message that reads like a permissions
# problem. Say what it is; do not delete it, because a git that IS running
# would then race.
if [ -f .git/index.lock ]; then
  fatal 65 ".git/index.lock exists. If nothing is running: rm -f $REPO/.git/index.lock"
fi
for state in rebase-apply rebase-merge MERGE_HEAD CHERRY_PICK_HEAD; do
  if [ -e ".git/$state" ]; then
    fatal 65 ".git/$state — a git operation was left half-finished. Resolve it by hand; do NOT abort it blindly, it can reset HEAD past work that was never pushed."
  fi
done

DIRT="$(git status --porcelain)"
if [ -n "$DIRT" ]; then
  log "working tree is dirty:"
  printf '%s\n' "$DIRT" | sed 's/^/    /' | tee -a "$RUN_LOG" >/dev/null
  printf '%s\n' "$DIRT" | sed 's/^/    /'
  fatal 64 "refusing to start on a dirty tree — an untracked file becomes somebody else's commit"
fi
if [ -n "$(git stash list)" ]; then
  log "note: there are stashes. Swept-up work never reaches a pull request:"
  git stash list | sed 's/^/    /'
fi

# --------------------------------------------------------------------------
# Start from an up-to-date main, fast-forward only. --ff-only is the guard: if
# main and origin/main have diverged, somebody has been committing locally to
# main and this job is not the thing to sort that out.
# --------------------------------------------------------------------------
STARTED_ON="$(git rev-parse --abbrev-ref HEAD)"
log "fetching origin"
git fetch --prune origin >/dev/null 2>&1 || fatal 78 "git fetch failed — no network, or no credential for origin"
git checkout main >/dev/null 2>&1 || fatal 78 "could not check out main"
git merge --ff-only origin/main >/dev/null 2>&1 || fatal 65 "main has diverged from origin/main — a person untangles that"
log "main is at $(git rev-parse --short HEAD)"

BRANCH="overnight/auto-$STAMP-$(date '+%H%M')"
git checkout -b "$BRANCH" >/dev/null 2>&1 || fatal 78 "could not create $BRANCH"
OWNS_BRANCH=1
log "working on $BRANCH"

# main's .gitignore is not this branch's. If the base is missing an entry for
# something the run generates, npm and Playwright quietly fill the tree with
# untracked files and tomorrow night aborts on a dirty tree with no clue why.
# Check it here, where the message can say which branch and which path.
for path in node_modules .tmp playwright-report test-results; do
  git check-ignore -q "$path" || fatal 78 "$BRANCH does not ignore $path -- npm or Playwright will dirty the tree. Merge the branch that adds it before scheduling nights."
done

if [ "$DRY_RUN" = "1" ]; then
  # A probe that asks for the word OK proves the CLI is reachable and nothing
  # else. It does not prove the agent can edit a file, that git works from in
  # there, or — the one that would hang a real night until the next fire — that
  # --dangerously-skip-permissions actually suppresses prompts under launchd,
  # where there is no TTY to answer one. An answering CLI and a working night
  # are different things, and only the second is worth a dry run (CLAUDE.md 12).
  #
  # So the probe does the smallest thing a real night does: write a file, and
  # commit it. The commit dies with the scratch branch, which is deleted on the
  # way out either way, so nothing is pushed and the file does not survive the
  # checkout back.
  log "dry run: probing $CLAUDE_BIN — can it edit and commit, not just answer"
  PROBE="$LOG_DIR/probe-$STAMP.log"
  PROBE_BEFORE="$(git rev-parse HEAD)"
  run_limited 420 "$CLAUDE_BIN" "${CLAUDE_ARGS[@]}" \
    'Create a file called .dry-run-probe containing the single word ok. git add it and commit it with the message "dry run probe". Do nothing else: change no other file, create no branch, push nothing.' \
    >"$PROBE" 2>&1 || true
  PROBE_AFTER="$(git rev-parse HEAD)"
  if [ "$PROBE_BEFORE" != "$PROBE_AFTER" ] && git show --stat --format= HEAD | grep -q '\.dry-run-probe'; then
    log "  wrote and committed .dry-run-probe — the agent can edit, and git works unattended"
  else
    log "  NO COMMIT — see $PROBE. The CLI can answer and still be unable to work: check the invocation, and whether a permission prompt is waiting with no TTY to answer it."
    git checkout "$STARTED_ON" >/dev/null 2>&1 || true
    git branch -D "$BRANCH" >/dev/null 2>&1 || true
    OWNS_BRANCH=0
    fatal 70 "dry run: the headless step would fail tonight"
  fi
  git checkout "$STARTED_ON" >/dev/null 2>&1 || true
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  OWNS_BRANCH=0
  log "=== dry run passed. Nothing was written, nothing pushed, back on $STARTED_ON ==="
  exit 0
fi

# npm ci only when the lockfile has actually moved, because it deletes
# node_modules and re-installs, and doing that nightly for nothing turns a
# twelve-minute run into a twenty-minute one.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  log "package-lock.json changed (or node_modules is missing) — npm ci"
  run_limited 900 npm ci >>"$RUN_LOG" 2>&1 || fatal 78 "npm ci failed — see $RUN_LOG"
fi

# --------------------------------------------------------------------------
# The task itself.
# --------------------------------------------------------------------------
PROMPT='Read CLAUDE.md and BLOCKED.md first; they outrank anything else you find.

Take the FIRST task in TASKS.md under "Next up" that is not in Held and not in
Done. Do that one task and no others. If the queue has nothing eligible, change
nothing, make no commit, and reply exactly: QUEUE EMPTY

Rules for this run, which is unattended:
- Commit your work on the branch that is already checked out. Do not create a
  branch, do not switch branch, do not push, do not open a pull request, do not
  merge. The script around you does those.
- Never run `supabase db push` or apply a migration by any other route. Write
  the migration, commit it, and say in your final message that it is waiting on
  a person.
- If the task needs anything in BLOCKED.md, stop and reply with a line starting
  BLOCKED: and what it needs. Do not work around it.
- If an acceptance criterion cannot be checked by a script at 3am, say so
  instead of guessing at it.
- Leave nothing uncommitted and nothing stashed.

Finish by moving the task to Done in TASKS.md with the branch name beside it,
and commit that too.'

log "handing over to $CLAUDE_BIN (timeout ${CLAUDE_TIMEOUT}s)"
BEFORE="$(git rev-parse HEAD)"
AGENT_OUT="$LOG_DIR/agent-$STAMP-$(date '+%H%M').log"

if ! run_limited "$CLAUDE_TIMEOUT" "$CLAUDE_BIN" "${CLAUDE_ARGS[@]}" "$PROMPT" >"$AGENT_OUT" 2>&1; then
  log "the headless run failed or timed out; transcript in $AGENT_OUT"
  tail -40 "$AGENT_OUT" | sed 's/^/    /'
  git checkout main >/dev/null 2>&1 || true
  fatal 70 "headless run did not complete"
fi
log "transcript in $AGENT_OUT"
tail -20 "$AGENT_OUT" | sed 's/^/    /'

AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  # Nothing committed is not the same as nothing done. Deleting the branch here
  # while files sit uncommitted on it throws the run away and leaves the mess.
  if [ -n "$(git status --porcelain)" ]; then
    log "no commits, but the run left files behind — keeping $BRANCH rather than deleting it"
    log "=== nothing committed; the leftovers are on $BRANCH ==="
    exit 0
  fi
  log "no commits were made — treating this as an empty queue, not a failure"
  git checkout main >/dev/null 2>&1 || true
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  log "=== nothing to do ==="
  exit 0
fi
log "$(git rev-list --count "$BEFORE".."$AFTER") commit(s) on $BRANCH"

# The agent is told to leave nothing uncommitted. Trust, then check — an
# untracked file left here is what aborts tomorrow night.
LEFTOVER="$(git status --porcelain)"
if [ -n "$LEFTOVER" ]; then
  log "the run left the tree dirty:"
  printf '%s\n' "$LEFTOVER" | sed 's/^/    /'
  # `git add -A` is the useful thing to do with a file the agent forgot to add
  # and the wrong thing to do with a credential or a transcript. Both
  # repositories are public (BLOCKED.md), so this is checked rather than
  # assumed, and a match stops the run instead of committing.
  # Matched against the whole status line rather than a parsed field: a
  # filename with a space in it would defeat the parse, and the only cost of
  # over-matching is a run that stops for a person to look at.
  if looks_like_a_secret "$LEFTOVER"; then
    fatal 64 "something that must not be committed was left untracked -- a person looks at this, the tree stays as it is"
  fi
  log "committing it rather than leaving it, so tomorrow night can start"
  git add -A
  git commit -m "overnight: sweep up files left uncommitted by the run" >/dev/null
fi

# --------------------------------------------------------------------------
# Verify, then publish. A failing branch is still pushed — as a draft — because
# a night's work sitting only on this Mac helps nobody, and a draft cannot be
# merged by accident.
# --------------------------------------------------------------------------
log "npm run verify (timeout ${VERIFY_TIMEOUT}s)"
VERIFY_LOG="$LOG_DIR/verify-$STAMP-$(date '+%H%M').log"
VERIFY_RC=0
run_limited "$VERIFY_TIMEOUT" npm run verify >"$VERIFY_LOG" 2>&1 || VERIFY_RC=$?

git push -u origin "$BRANCH" >/dev/null 2>&1 || fatal 78 "could not push $BRANCH — check gh auth; the commits are safe locally"
log "pushed $BRANCH"

BODY_FILE="$LOG_DIR/pr-body-$STAMP.md"
{
  printf 'Opened by the 03:00 run on %s.\n\n' "$STAMP"
  printf '## Commits\n\n'
  git log --format='- %s' "$BEFORE".."$(git rev-parse HEAD)"
  printf '\n## verify\n\n'
  if [ "$VERIFY_RC" -eq 0 ]; then
    printf '`npm run verify` passed.\n'
  else
    printf '`npm run verify` FAILED (exit %s). Last 60 lines:\n\n```\n' "$VERIFY_RC"
    tail -60 "$VERIFY_LOG"
    printf '\n```\n'
  fi
  printf '\nNo migration was applied. If one was written it is waiting on a person.\n'
} >"$BODY_FILE"

if [ "$VERIFY_RC" -eq 0 ]; then
  log "verify passed — opening a pull request"
  gh pr create --base main --head "$BRANCH" \
    --title "overnight: $STAMP" --body-file "$BODY_FILE" \
    || fatal 78 "gh pr create failed; the branch is pushed, open it by hand"
  git checkout main >/dev/null 2>&1 || true
  log "=== done ==="
  exit 0
fi

log "verify FAILED (exit $VERIFY_RC) — opening a DRAFT pull request instead"
tail -40 "$VERIFY_LOG" | sed 's/^/    /'
gh pr create --draft --base main --head "$BRANCH" \
  --title "overnight: $STAMP — verify FAILED" --body-file "$BODY_FILE" \
  || log "gh pr create failed too; the branch is pushed, open it by hand"
git checkout main >/dev/null 2>&1 || true
fatal 69 "the task was done but verify failed — see the draft pull request"

#!/usr/bin/env bash
#
# overnight.sh — one task from TASKS.md, one branch, one pull request, and —
# only when the merge gate passes — one merge.
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
#   - It never pushes to main. It pushes an overnight/* branch and opens a pull
#     request. It merges that pull request only when merge_gate passes — code
#     in this file and deploy/merge-gate.sh, not wording in the agent's prompt
#     — and only with `gh pr merge`, never --admin. Anything the gate refuses
#     waits for a person. BLOCKED.md, "Release"; docs/OPERATIONS.md,
#     "Auto-merge".
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
#   70  also: the agent ended without committing, even after being asked to
#       finish — its files are published as a DRAFT pull request
#   71  merged, production then failed its check, and the merge was reverted
#       through the same gate; production re-checked after the revert
#   72  merged, production failed, and the revert could not be completed — the
#       kill switch has been turned on and everything is left for a person
#   78  a prerequisite is missing (a command, the repo, TASKS.md, or gh could
#       not list open pull requests — the stall guard needs that list)

set -euo pipefail

# --------------------------------------------------------------------------
# Protected paths. A pull request that touches any of these is never merged by
# the gate; it waits for a person. Globs, matched with bash `[[ == ]]`, where
# `*` also matches `/`. scripts/test-merge-gate.sh reads this block between the
# BEGIN and END markers, so the list that is tested is this list.
#
# Over-matching costs one pull request that a person merges by hand.
# Under-matching costs an unreviewed change to sign-in, data or the machinery
# that decides what ships. The asymmetry is the design.
# --------------------------------------------------------------------------
# BEGIN PROTECTED_PATHS
PROTECTED_PATHS=(
  # data
  'supabase/*'
  # sign-in and sessions
  'src/app/auth/*'
  'src/app/actions/auth.ts'
  'src/app/api/test/*'
  'src/proxy.ts'
  'src/middleware.ts'
  'src/lib/supabase/*'
  'src/lib/env.ts'
  'src/lib/session.ts'
  'src/lib/current-user.ts'
  'src/lib/guard.ts'
  'src/lib/staff.ts'
  'src/lib/rate-limit.ts'
  'src/lib/rate-limit-store.ts'
  # the machinery: the runner, the gate, CI, and what the suite runs on
  'overnight.sh'
  'deploy/*'
  'scripts/*'
  '.github/*'
  'playwright.config.ts'
  'tests/harness.ts'
  'tests/global-setup.ts'
  # the rules
  'CLAUDE.md'
  'BLOCKED.md'
  # dependencies, build and configuration
  'package.json'
  'package-lock.json'
  'next.config.ts'
  'tsconfig.json'
  'vercel.json'
  '.env*'
  '.gitignore'
)
# END PROTECTED_PATHS

# Creating this file stops all merging, with no other change. The gate reads it
# on every run; so does the revert, which also creates it when it fails.
KILL_SWITCH="${AUTOMERGE_KILL_SWITCH:-$HOME/.config/poweranalytix/automerge-off}"

# Where the one-merge-a-night stamp lives. Not ~/Library/Caches, which macOS may
# empty.
STATE_DIR="${PORTAL_STATE_DIR:-$HOME/.local/state/poweranalytix}"

# Production, for the check after a merge. The repository did not record it
# until this line: it comes from `vercel inspect` on the production deployment
# (27 September 2026), which lists it among that deployment's aliases. It is the
# alias that answers publicly — the others sit behind Vercel's login. When the
# domain cutover happens, this becomes https://portal.poweranalytix.co.uk.
PRODUCTION_URL="${PORTAL_PRODUCTION_URL:-https://portaltest-sigma.vercel.app}"
GH_REPO_SLUG="${PORTAL_GH_REPO:-BigWez79/portaltest}"

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
      # The libraries go with it, for the same reason: this run will check out
      # branches, and the gate must be the one that was here when it started.
      for lib in task-headings.sh merge-gate.sh; do
        cp "$REPO/deploy/$lib" "$(dirname "$RUNNING_COPY")/$lib" 2>/dev/null || true
      done
      chmod 0755 "$RUNNING_COPY"
      echo "running from $RUNNING_COPY, because $SELF is inside the checkout this run will move"
      PORTAL_REEXEC=1 exec "$RUNNING_COPY" "$@"
      ;;
  esac
fi

# --------------------------------------------------------------------------
# The task arithmetic and the merge gate. Sourced from beside THIS file — the
# installed copy in ~/.local/libexec/poweranalytix when launchd runs it — and
# before anything is checked out, so the functions in memory are the ones that
# were installed, not whatever a branch has made of deploy/. Falls back to the
# repo only for a copy that was never installed.
# --------------------------------------------------------------------------
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
for lib in task-headings.sh merge-gate.sh; do
  if [ -f "$LIB_DIR/$lib" ]; then
    # shellcheck source=/dev/null
    . "$LIB_DIR/$lib"
  elif [ -f "$REPO/deploy/$lib" ]; then
    # shellcheck source=/dev/null
    . "$REPO/deploy/$lib"
  else
    echo "FATAL(78): $lib is not installed beside $0 — run deploy/install.sh" >&2
    exit 78
  fi
done

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

# --------------------------------------------------------------------------
# Which task — decided here, in code, before the agent is involved.
#
# The stall guard. Between the 4th and the 9th of September five runs each
# built "Deactivate on the admin screen should end the session too", because
# main had not moved and the task stayed at the top of the queue. The guard
# against that used to be a list handed to the agent in its prompt. Now the
# script picks the task and never picks one an open pull request is building.
#
# A pull request on overnight/auto-* is building a task if:
#   - its body has a "Task: T-n" line (every pull request this runner opens
#     does, on its first line), or
#   - its branch has taken T-n out of Next up.
# Drafts count. A draft is work waiting for a person, and building the same
# task again beside it is the stall this exists to stop.
#
# Rule 12 — what would have to be true for this to build a task twice? A pull
# request with neither the line nor the TASKS.md change: one opened by hand
# without "Task:", from a branch that never reached Done. And if gh cannot list
# pull requests at all, the run stops (78) rather than guessing an empty list.
# --------------------------------------------------------------------------
claimed_task_ids() {
  local prs num head body_ids branch_ids main_ids id
  prs="$(gh pr list --repo "$GH_REPO_SLUG" --state open --limit 100 \
           --json number,headRefName \
           --jq '.[] | select(.headRefName | startswith("overnight/auto-")) | "\(.number) \(.headRefName)"')" || return 1
  main_ids="$(git show origin/main:TASKS.md 2>/dev/null | next_up_ids | sort -u)"
  while read -r num head; do
    [ -n "$num" ] || continue
    body_ids="$(gh pr view "$num" --repo "$GH_REPO_SLUG" --json body --jq .body 2>/dev/null \
                  | sed -n 's/^Task: *\(T-[0-9][0-9]*\).*/\1/p' || true)"
    branch_ids=""
    if git fetch --quiet origin "$head" >/dev/null 2>&1; then
      branch_ids="$(comm -23 <(printf '%s\n' "$main_ids" | sed '/^$/d') \
                     <(git show "origin/$head:TASKS.md" 2>/dev/null | next_up_ids | sort -u) || true)"
    fi
    for id in $body_ids $branch_ids; do
      printf '%s #%s\n' "$id" "$num"
    done
  done <<EOF
$prs
EOF
}

CLAIMS="$(claimed_task_ids)" || fatal 78 "gh could not list open pull requests — refusing to guess, because a guess could build a task twice"
MAIN_TASKS="$(git show origin/main:TASKS.md)"
TASK_ID=""
HELD_BY=""
for id in $(printf '%s\n' "$MAIN_TASKS" | next_up_ids); do
  prs="$(printf '%s\n' "$CLAIMS" | awk -v id="$id" '$1 == id { print $2 }' | sort -u | tr '\n' ' ')"
  if [ -n "$prs" ]; then
    log "$id already has an open pull request ($prs) — skipped"
    HELD_BY="$HELD_BY$prs"
    continue
  fi
  TASK_ID="$id"
  break
done
UNNUMBERED="$(printf '%s\n' "$MAIN_TASKS" | next_up_unnumbered)"
if [ -n "$UNNUMBERED" ]; then
  log "these tasks under Next up have no T- ID, so they are never picked — give each one:"
  printf '%s\n' "$UNNUMBERED" | sed 's/^/    /' | tee -a "$RUN_LOG"
fi
if [ -z "$TASK_ID" ]; then
  if [ -n "$HELD_BY" ]; then
    WHY="queue blocked by open PRs: $(printf '%s\n' $HELD_BY | sort -u | tr '\n' ' ')"
  else
    WHY="QUEUE EMPTY"
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "dry run: tonight would stop here — $WHY"
  else
    log "=== $WHY — nothing to build ==="
    exit 0
  fi
else
  TASK_HEADING="$(printf '%s\n' "$MAIN_TASKS" | heading_for_id "$TASK_ID")"
  log "tonight's task: $TASK_HEADING"
fi

BRANCH="overnight/auto-$STAMP-$(date '+%H%M')"
git checkout -b "$BRANCH" >/dev/null 2>&1 || fatal 78 "could not create $BRANCH"
OWNS_BRANCH=1
log "working on $BRANCH"

# main's .gitignore is not this branch's. If the base is missing an entry for
# something the run generates, npm and Playwright quietly fill the tree with
# untracked files and tomorrow night aborts on a dirty tree with no clue why.
# Check it here, where the message can say which branch and which path.
#
# `.tmp` is checked as a bare name, and .gitignore's `.tmp/` only matches a
# directory that exists: on a fresh checkout this fails (19:07, 26 September).
# The Mac Studio carries `.tmp` in .git/info/exclude for that reason.
for path in node_modules .tmp playwright-report test-results; do
  git check-ignore -q "$path" || fatal 78 "$BRANCH does not ignore $path -- npm or Playwright will dirty the tree. Merge the branch that adds it before scheduling nights."
done

# --------------------------------------------------------------------------
# Helpers for everything after this point.
# --------------------------------------------------------------------------
merged_today() {
  [ "$(cat "$STATE_DIR/last-merge" 2>/dev/null || true)" = "$STAMP" ] && echo 1 || echo 0
}

# "300 passed (40.0s)" -> 300. Empty if the suite never reached its summary.
passed_count() {
  grep -Eo '[0-9]+ passed' "$1" 2>/dev/null | tail -1 | grep -Eo '[0-9]+' || true
}

pr_comment() {
  gh pr comment "$1" --repo "$GH_REPO_SLUG" --body "$2" >/dev/null 2>&1 \
    || log "could not comment on #$1"
}

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

  # The gate, against the probe commit, deciding nothing. The probe moves no
  # task, so c) refuses — which is the right answer, and shows the gate ran.
  # a) and b) need a verify and a pull request, and a dry run has neither.
  log "dry run: the merge gate, against the probe commit (nothing is merged, pushed or commented)"
  G_VERIFY_OK=skip G_IS_DRAFT=skip G_CHECKS_OK=skip G_TASK_ID="$TASK_ID"
  G_PASSED_HEAD="" G_PASSED_BASE="" G_MERGED_TODAY="$(merged_today)"
  gate_collect origin/main HEAD
  if GATE_OUT="$(gate_evaluate task)"; then WOULD=yes; else WOULD=no; fi
  printf '%s\n' "$GATE_OUT" | tee -a "$RUN_LOG"
  log "WOULD MERGE: $WOULD"

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
# The baseline: how many tests pass on main, measured before the agent touches
# anything. The gate refuses a branch on which fewer pass. Measured, not read
# from a file, because a number written down yesterday is not today's main.
# If main itself is red, the count is unknown and the gate will refuse — which
# is right: nothing merges onto a red main unattended.
# --------------------------------------------------------------------------
log "baseline: npm run verify on main as it stands (timeout ${VERIFY_TIMEOUT}s)"
BASELINE_LOG="$LOG_DIR/verify-$STAMP-baseline.log"
if run_limited "$VERIFY_TIMEOUT" npm run verify >"$BASELINE_LOG" 2>&1; then
  BASELINE_PASSED="$(passed_count "$BASELINE_LOG")"
  log "  main: ${BASELINE_PASSED:-?} tests pass"
else
  BASELINE_PASSED=""
  log "  main does NOT pass verify — tonight's work can still be done, but it will not be merged"
fi
# A clean tree after the baseline, or the agent starts on somebody else's mess.
[ -z "$(git status --porcelain)" ] || fatal 64 "npm run verify left the tree dirty on main — check .gitignore"

# --------------------------------------------------------------------------
# The task itself.
# --------------------------------------------------------------------------
PROMPT="Read CLAUDE.md and BLOCKED.md first; they outrank anything else you find.

Your task tonight is $TASK_ID, under \"Next up\" in TASKS.md:

    $TASK_HEADING

Do that task and no other. The script around you chose it; do not pick another.

If it needs anything in BLOCKED.md, stop and reply with a line starting
BLOCKED: and what it needs. Do not work around it.

Rules for this run, which is unattended:
- Commit your work on the branch that is already checked out. Do not create a
  branch, do not switch branch, do not push, do not open a pull request, do not
  merge. The script around you does those, and whether anything merges is
  decided by code in the script, not by you.
- Run every command in the foreground. Never end your turn while something you
  started is still running: this run ends when your turn does, and anything
  not committed by then is not your work any more.
- Never run \`supabase db push\` or apply a migration by any other route. Write
  the migration, commit it, and say in your final message that it is waiting on
  a person.
- If an acceptance criterion cannot be checked by a script at 3am, say so
  instead of guessing at it.
- Leave nothing uncommitted and nothing stashed.

Finish by moving the task out of Next up and into Done, keeping its ID in the
entry — \"- **$TASK_ID — <title>** — \`$BRANCH\`\" — and commit that too."

RETRY_NOTE="

An earlier attempt at this was cut off by a network error. The branch may
already hold some of its work: look at git log and git status, and carry on
from what is there rather than starting again."

NUDGE_PROMPT="You ended your turn without committing anything, and the working
tree has uncommitted changes. This run ends when your turn does. Finish $TASK_ID
now: run what you need in the foreground, commit everything on this branch, and
move $TASK_ID to Done as you were asked. Do not start anything in the background."

# --------------------------------------------------------------------------
# The time budget. Retries and fix attempts come out of the budget the run
# already had — CLAUDE_TIMEOUT for the agent plus VERIFY_TIMEOUT for verify —
# counted from the moment the agent starts. They do not extend the night.
# --------------------------------------------------------------------------
RUN_BUDGET="${RUN_BUDGET:-$((CLAUDE_TIMEOUT + VERIFY_TIMEOUT))}"
RETRY_WAIT="${RETRY_WAIT:-300}"
DEADLINE=$(( $(date +%s) + RUN_BUDGET ))
remaining() { echo $(( DEADLINE - $(date +%s) )); }
# budget_for MAX [RESERVE] — MAX, or what is left after RESERVE, whichever is less.
budget_for() {
  local left=$(( $(remaining) - ${2:-0} ))
  [ "$left" -lt "$1" ] && echo "$left" || echo "$1"
}

AGENT_OUT="$LOG_DIR/agent-$STAMP-$(date '+%H%M').log"

# run_agent PROMPT [continue] [RESERVE] — one headless run inside the budget.
run_agent() {
  local prompt="$1" limit
  local args=("${CLAUDE_ARGS[@]}")
  [ "${2:-}" = "continue" ] && args+=(--continue)
  limit="$(budget_for "$CLAUDE_TIMEOUT" "${3:-0}")"
  if [ "$limit" -lt 120 ]; then
    log "  no budget left for another agent run (${limit}s)"
    return 124
  fi
  printf '\n===== %s (limit %ss) =====\n' "$(date '+%H:%M:%S')" "$limit" >>"$AGENT_OUT"
  run_limited "$limit" "$CLAUDE_BIN" "${args[@]}" "$prompt" >>"$AGENT_OUT" 2>&1
}

# A failure worth one retry: the network or the API, not the agent and not the
# clock. 143 and 137 are run_limited's TERM and KILL — a timeout is not
# transient, and retrying it would spend the rest of the budget doing it again.
# Only the tail is read, so an error the agent merely talked about earlier in
# its transcript does not count.
is_transient() {
  local rc="$1"
  [ "$rc" -ne 0 ] || return 1
  [ "$rc" -ne 143 ] && [ "$rc" -ne 137 ] || return 1
  tail -40 "$AGENT_OUT" | grep -Eiq 'ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|socket hang up|overloaded|API Error: *5[0-9][0-9]|(status|HTTP)[^0-9]{0,12}5[0-9][0-9]|(^|[^0-9])529([^0-9]|$)'
}

sweep_leftovers() {
  local left
  left="$(git status --porcelain)"
  [ -n "$left" ] || return 0
  log "the run left files uncommitted:"
  printf '%s\n' "$left" | sed 's/^/    /'
  # `git add -A` is the useful thing to do with a file the agent forgot to add
  # and the wrong thing to do with a credential or a transcript. Both
  # repositories are public (BLOCKED.md), so this is checked rather than
  # assumed, and a match stops the run instead of committing.
  if looks_like_a_secret "$left"; then
    fatal 64 "something that must not be committed was left untracked -- a person looks at this, the tree stays as it is"
  fi
  git add -A
  git commit -q -m "${1:-overnight: sweep up files left uncommitted by the run}"
}

VERIFY_RC=1
VERIFIED_SHA=""
VERIFY_LOG=""
run_verify() {
  local limit
  limit="$(budget_for "$VERIFY_TIMEOUT")"
  [ "$limit" -ge 600 ] || limit=600   # verify always gets a fair run
  VERIFY_LOG="$LOG_DIR/verify-$STAMP-$(date '+%H%M%S').log"
  log "npm run verify (timeout ${limit}s)"
  VERIFY_RC=0
  run_limited "$limit" npm run verify >"$VERIFY_LOG" 2>&1 || VERIFY_RC=$?
  VERIFIED_SHA="$(git rev-parse HEAD)"
  # verify writes nothing tracked; if it did, that is a change nobody verified
  if [ -n "$(git status --porcelain)" ]; then
    log "verify left the tree dirty — treating the result as unverified"
    sweep_leftovers "overnight: files npm run verify wrote"
    VERIFY_RC=1
  fi
  log "  verify exit $VERIFY_RC, $(passed_count "$VERIFY_LOG") passed"
}

log "handing $TASK_ID to $CLAUDE_BIN (budget ${RUN_BUDGET}s)"
BEFORE="$(git rev-parse HEAD)"

AGENT_RC=0
run_agent "$PROMPT" || AGENT_RC=$?
if is_transient "$AGENT_RC"; then
  if [ "$(remaining)" -gt $((RETRY_WAIT + 900)) ]; then
    log "the headless run hit a network or API error (exit $AGENT_RC) — waiting ${RETRY_WAIT}s, then one retry"
    sleep "$RETRY_WAIT"
    AGENT_RC=0
    run_agent "$PROMPT$RETRY_NOTE" || AGENT_RC=$?
  else
    log "the headless run hit a network or API error, and there is no budget left to retry"
  fi
fi
if [ "$AGENT_RC" -ne 0 ]; then
  log "the headless run failed or timed out (exit $AGENT_RC); transcript in $AGENT_OUT"
  tail -40 "$AGENT_OUT" | sed 's/^/    /'
  git checkout main >/dev/null 2>&1 || true
  fatal 70 "headless run did not complete"
fi
log "transcript in $AGENT_OUT"
tail -20 "$AGENT_OUT" | sed 's/^/    /'

INCOMPLETE=0
if [ "$BEFORE" = "$(git rev-parse HEAD)" ]; then
  if [ -z "$(git status --porcelain)" ]; then
    # Nothing written and nothing committed: blocked, or the agent did nothing.
    if grep -q '^BLOCKED:' "$AGENT_OUT" 2>/dev/null; then
      log "BLOCKED — $TASK_ID cannot start:"
      grep -m 5 -A 4 '^BLOCKED:' "$AGENT_OUT" | sed 's/^/    /' | tee -a "$RUN_LOG"
      git checkout main >/dev/null 2>&1 || true
      git branch -D "$BRANCH" >/dev/null 2>&1 || true
      OWNS_BRANCH=0
      log "=== blocked, nothing done ==="
      exit 0
    fi
    log "no commits and no changes — the agent did nothing with $TASK_ID"
    git checkout main >/dev/null 2>&1 || true
    git branch -D "$BRANCH" >/dev/null 2>&1 || true
    OWNS_BRANCH=0
    log "=== nothing done ==="
    exit 0
  fi

  # Files written, nothing committed: the agent ended its turn early. On the
  # 27th of September it started verify in the background and said it would
  # wait; `claude -p` ends when the turn does, and a night's work was left
  # uncommitted on this Mac. Ask it once to finish, in the same conversation.
  log "the agent ended its turn with changes but no commits — asking it once to finish"
  run_agent "$NUDGE_PROMPT" continue "$VERIFY_TIMEOUT" || log "  the follow-up ended with exit $?"
  if [ "$BEFORE" = "$(git rev-parse HEAD)" ]; then
    log "still nothing committed — publishing what it wrote as a DRAFT, so it is not stranded here"
    sweep_leftovers "overnight: $TASK_ID left uncommitted by an incomplete run"
    INCOMPLETE=1
  fi
fi
log "$(git rev-list --count "$BEFORE"..HEAD) commit(s) on $BRANCH"

# The agent is told to leave nothing uncommitted. Trust, then check — an
# untracked file left here is what aborts tomorrow night.
sweep_leftovers

# --------------------------------------------------------------------------
# Verify, and let the agent fix what fails. At most two fix attempts, inside
# the budget. The agent may fix code; it may not delete, skip or weaken tests,
# and the gate checks the parts of that a script can see.
# --------------------------------------------------------------------------
run_verify
FIX_ATTEMPTS=0
while [ "$VERIFY_RC" -ne 0 ] && [ "$INCOMPLETE" -eq 0 ] && [ "$FIX_ATTEMPTS" -lt 2 ]; do
  if [ "$(remaining)" -lt 900 ]; then
    log "verify failed and under 15 minutes of budget is left — no further fix attempt"
    break
  fi
  FIX_ATTEMPTS=$((FIX_ATTEMPTS + 1))
  log "verify failed — fix attempt $FIX_ATTEMPTS of 2"
  FIX_PROMPT="npm run verify failed on your work for $TASK_ID. The last lines of its output:

$(tail -120 "$VERIFY_LOG")

Fix the code so that verify passes, then commit. Rules for this fix:
- You may change application code, and you may add tests.
- You may NOT delete a test, add .skip, .only or .fixme, loosen an assertion,
  or change what a test expects so that it passes. If a test is right and the
  code is wrong, fix the code. If you believe a test is wrong, say so in your
  final message and leave it as it is.
- Do not touch deploy/, overnight.sh, scripts/, .github/, playwright.config.ts,
  tests/harness.ts, package.json or package-lock.json.
- Run everything in the foreground and commit before you finish."
  run_agent "$FIX_PROMPT" continue "$VERIFY_TIMEOUT" || log "  the fix attempt ended with exit $?"
  sweep_leftovers
  run_verify
done

# --------------------------------------------------------------------------
# Publish. A failing or incomplete branch is still pushed — as a draft —
# because a night's work sitting only on this Mac helps nobody, and a draft
# cannot be merged by accident, by the gate or anyone else.
# --------------------------------------------------------------------------
git push -u origin "$BRANCH" >/dev/null 2>&1 || fatal 78 "could not push $BRANCH — check gh auth; the commits are safe locally"
log "pushed $BRANCH"

BODY_FILE="$LOG_DIR/pr-body-$STAMP.md"
{
  # First line, always: the stall guard reads it.
  printf 'Task: %s\n\n' "$TASK_ID"
  printf 'Opened by the 03:00 run on %s: **%s**\n\n' "$STAMP" "$TASK_HEADING"
  printf '## Commits\n\n'
  git log --format='- %s' "$BEFORE"..HEAD
  printf '\n## verify\n\n'
  if [ "$INCOMPLETE" -eq 1 ]; then
    printf 'The agent ended without committing, even when asked to finish. These are the files it left, committed by the script and **not reviewed**.\n\n'
  fi
  if [ "$VERIFY_RC" -eq 0 ]; then
    printf '`npm run verify` passed: %s tests (main: %s).\n' "$(passed_count "$VERIFY_LOG")" "${BASELINE_PASSED:-unknown}"
  else
    printf '`npm run verify` FAILED (exit %s) after %s fix attempt(s). Last 60 lines:\n\n```\n' "$VERIFY_RC" "$FIX_ATTEMPTS"
    tail -60 "$VERIFY_LOG"
    printf '\n```\n'
  fi
  printf '\nNo migration was applied. If one was written it is waiting on a person.\n'
} >"$BODY_FILE"

if [ "$VERIFY_RC" -ne 0 ] || [ "$INCOMPLETE" -eq 1 ]; then
  TITLE="overnight: $STAMP — $TASK_HEADING — "
  [ "$INCOMPLETE" -eq 1 ] && TITLE="${TITLE}incomplete" || TITLE="${TITLE}verify FAILED"
  gh pr create --repo "$GH_REPO_SLUG" --draft --base main --head "$BRANCH" \
    --title "$TITLE" --body-file "$BODY_FILE" \
    || log "gh pr create failed too; the branch is pushed, open it by hand"
  git checkout main >/dev/null 2>&1 || true
  [ "$INCOMPLETE" -eq 1 ] && fatal 70 "the agent did not finish — see the draft pull request"
  fatal 69 "the task was done but verify failed — see the draft pull request"
fi

log "verify passed — opening a pull request"
NEW_PR="$(gh pr create --repo "$GH_REPO_SLUG" --base main --head "$BRANCH" \
  --title "overnight: $STAMP — $TASK_HEADING" --body-file "$BODY_FILE")" \
  || fatal 78 "gh pr create failed; the branch is pushed, open it by hand"
PR_NUM="${NEW_PR##*/}"
log "opened $NEW_PR"

# --------------------------------------------------------------------------
# Close the draft this run has just superseded.
#
# With the stall guard above counting drafts, a draft on overnight/auto-* now
# holds its task until a person deals with it, so this rarely finds anything.
# It still closes a draft on another overnight/* branch that removed the same
# heading, and it fails safe: no gh, no match, or a branch that cannot be
# fetched all leave the draft open.
# --------------------------------------------------------------------------
supersede_drafts() {
  local new_pr="$1" mine main_h pr_h overlap
  command -v gh >/dev/null 2>&1 || return 0

  main_h="$(git show origin/main:TASKS.md 2>/dev/null | task_titles || true)"
  [ -n "$main_h" ] || return 0

  # What this run claims: headings on main that its own branch no longer has.
  mine="$(git show "$BRANCH:TASKS.md" 2>/dev/null | task_titles || true)"
  [ -n "$mine" ] || return 0
  mine="$(headings_only_in_first "$main_h" "$mine")"
  [ -n "$mine" ] || return 0

  gh pr list --state open --limit 50 --json number,headRefName,isDraft \
    --jq '.[] | select(.isDraft) | "\(.number) \(.headRefName)"' 2>/dev/null |
  while read -r number branch; do
    [ -n "$number" ] || continue
    [ "$branch" = "$BRANCH" ] && continue
    case "$branch" in overnight/*) ;; *) continue ;; esac
    git fetch --quiet origin "$branch" >/dev/null 2>&1 || continue

    pr_h="$(git show "origin/$branch:TASKS.md" 2>/dev/null | task_titles || true)"
    [ -n "$pr_h" ] || continue

    overlap="$(headings_in_both "$(headings_only_in_first "$main_h" "$pr_h")" "$mine")"
    [ -n "$overlap" ] || continue

    log "closing draft #$number — superseded by $new_pr"
    gh pr close "$number" --comment "Superseded by $new_pr, which finished this task and passed verify.

This draft was opened by an earlier run whose verify failed. It is closed rather than left open so the next run does not have to read past it. The branch is not deleted; the commits are still there if anything on it is worth keeping." >/dev/null 2>&1 ||
      log "could not close draft #$number — leaving it open"
  done
}
supersede_drafts "$NEW_PR"

# --------------------------------------------------------------------------
# THE MERGE GATE. The only place anything is merged. The agent has finished and
# has no say: every condition is decided here, from git, gh and files, and any
# one failing leaves the pull request open for a person with a comment saying
# which. docs/OPERATIONS.md, "Auto-merge", is the same list in prose.
# --------------------------------------------------------------------------

# wait_for_checks PR CAP — 0 when every check on the pull request has passed
# (or been skipped), including one named `verify`; 1 on a failure, or when the
# cap runs out first. `--watch` waits; the JSON read afterwards decides,
# because a watch that returns 0 is not the same as a list that is all green.
wait_for_checks() {
  local pr="$1" deadline=$(( $(date +%s) + $2 )) n left bad has_verify
  while :; do
    n="$(gh pr checks "$pr" --repo "$GH_REPO_SLUG" --json name --jq length 2>/dev/null || true)"
    [ "${n:-0}" -gt 0 ] 2>/dev/null && break
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 20
  done
  left=$(( deadline - $(date +%s) ))
  [ "$left" -gt 0 ] || return 1
  run_limited "$left" gh pr checks "$pr" --repo "$GH_REPO_SLUG" --watch --interval 30 >/dev/null 2>&1 || true
  bad="$(gh pr checks "$pr" --repo "$GH_REPO_SLUG" --json bucket \
           --jq '[.[] | select(.bucket != "pass" and .bucket != "skipping")] | length' 2>/dev/null || echo 1)"
  has_verify="$(gh pr checks "$pr" --repo "$GH_REPO_SLUG" --json name \
                  --jq '[.[] | select(.name == "verify")] | length' 2>/dev/null || echo 0)"
  [ "$bad" = "0" ] && [ "${has_verify:-0}" -ge 1 ]
}

# merge_gate PR MODE — evaluate, then merge or comment. MODE is task or revert.
merge_gate() {
  local pr="$1" mode="$2" draft out
  log "merge gate ($mode) for #$pr"
  git fetch --quiet origin main >/dev/null 2>&1 || true

  G_VERIFY_OK=0
  [ "$VERIFY_RC" -eq 0 ] && [ "$VERIFIED_SHA" = "$(git rev-parse HEAD)" ] && G_VERIFY_OK=1
  draft="$(gh pr view "$pr" --repo "$GH_REPO_SLUG" --json isDraft --jq .isDraft 2>/dev/null || echo true)"
  G_IS_DRAFT=1; [ "$draft" = "false" ] && G_IS_DRAFT=0
  log "  waiting for GitHub checks on #$pr (cap 20 minutes)"
  G_CHECKS_OK=0; wait_for_checks "$pr" 1200 && G_CHECKS_OK=1
  G_TASK_ID="$TASK_ID"
  G_PASSED_HEAD="$(passed_count "$VERIFY_LOG")"
  G_PASSED_BASE="$BASELINE_PASSED"
  G_MERGED_TODAY="$(merged_today)"
  gate_collect origin/main HEAD

  if out="$(gate_evaluate "$mode")"; then
    printf '%s\n' "$out" | tee -a "$RUN_LOG"
    if gh pr merge "$pr" --repo "$GH_REPO_SLUG" --squash --delete-branch >/dev/null 2>&1; then
      log "  MERGED #$pr"
      return 0
    fi
    log "  every condition passed, but gh pr merge failed — main may have moved, or protection refused it"
    pr_comment "$pr" "The merge gate passed, but \`gh pr merge\` was refused (main may have moved, or branch protection said no). Left for a person."
    return 1
  fi
  printf '%s\n' "$out" | tee -a "$RUN_LOG"
  log "  gate REFUSED #$pr — it stays open for a person"
  pr_comment "$pr" "The merge gate refused this pull request, so it waits for a person. Failed:

$GATE_FAILURES
Full list:
\`\`\`
$out
\`\`\`"
  return 1
}

# production_ok SHA — Vercel's production deployment of SHA succeeded within
# 15 minutes, then the public site answers the way a working build does:
#   /       200 — the sign-in page (there is no /login; sign-in lives here)
#   /admin  a redirect to /?next=%2Fadmin — the proxy ran, and sent a
#           signed-out visitor home rather than failing
production_ok() {
  local sha="$1" deadline=$(( $(date +%s) + 900 )) id state root admin
  log "waiting for Vercel's production deployment of ${sha:0:7} (cap 15 minutes)"
  state=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    id="$(gh api "repos/$GH_REPO_SLUG/deployments?sha=$sha&environment=Production" --jq '.[0].id // empty' 2>/dev/null || true)"
    if [ -n "$id" ]; then
      state="$(gh api "repos/$GH_REPO_SLUG/deployments/$id/statuses" --jq '.[0].state // empty' 2>/dev/null || true)"
      case "$state" in
        success) break ;;
        failure|error) log "  the production deployment reported $state"; return 1 ;;
      esac
    fi
    sleep 20
  done
  [ "$state" = "success" ] || { log "  no successful production deployment within 15 minutes (last state: ${state:-none})"; return 1; }
  log "  deployed; smoke-testing $PRODUCTION_URL"
  root="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PRODUCTION_URL/" || echo 000)"
  admin="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "$PRODUCTION_URL/admin" || echo 000)"
  log "  /       -> $root"
  log "  /admin  -> $admin"
  [ "$root" = "200" ] || return 1
  case "$admin" in
    30[1278]\ "$PRODUCTION_URL/?next=%2Fadmin") return 0 ;;
  esac
  return 1
}

# revert_merge PR SHA — undo a merge that broke production, through the same
# gate in revert mode, then check production again. Exits 71 when production
# is healthy again; on any failure turns on the kill switch and exits 72.
revert_merge() {
  local pr="$1" sha="$2" rpr_url rpr rsha paths=()
  revert_failed() {
    mkdir -p "$(dirname "$KILL_SWITCH")"
    printf 'turned on by the 03:00 run on %s: the revert of #%s failed — %s\n' "$STAMP" "$pr" "$1" >"$KILL_SWITCH"
    log "REVERT FAILED: $1"
    log "the kill switch is ON ($KILL_SWITCH) — nothing merges until a person removes it"
    pr_comment "$pr" "This pull request was merged by the gate, and production then failed its check. The automatic revert did not complete: $1. The kill switch is now on, so nothing merges unattended until a person has looked. Production may be broken."
    git checkout main >/dev/null 2>&1 || true
    fatal 72 "production failed after merging #$pr, and the revert could not be completed"
  }

  log "production failed after merging #$pr — reverting through the gate"
  git fetch --quiet origin main >/dev/null 2>&1 || revert_failed "could not fetch main"
  BRANCH="overnight/revert-$STAMP-pr$pr"
  git checkout -q -B "$BRANCH" origin/main >/dev/null 2>&1 || revert_failed "could not create $BRANCH"
  OWNS_BRANCH=1
  git revert --no-edit "$sha" >/dev/null 2>&1 || { git revert --abort >/dev/null 2>&1 || true; revert_failed "git revert did not apply cleanly"; }

  while IFS= read -r p; do [ -n "$p" ] && paths+=("$p"); done \
    < <(git diff-tree --no-commit-id --name-only -r --no-renames "$sha")
  G_REVERT_PATHS="$(printf '%s\n' "${paths[@]}")"
  G_REVERT_EXACT=0
  git diff --quiet "$sha^" HEAD -- "${paths[@]}" && G_REVERT_EXACT=1

  run_verify
  git push -u origin "$BRANCH" >/dev/null 2>&1 || revert_failed "could not push $BRANCH"
  rpr_url="$(printf 'Task: none — revert of #%s\n\nProduction failed its check after #%s was merged by the gate (%s), so this undoes it. It touches only the paths #%s touched, and restores them exactly.\n' "$pr" "$pr" "${sha:0:7}" "$pr" \
    | gh pr create --repo "$GH_REPO_SLUG" --base main --head "$BRANCH" \
        --title "revert: #$pr — production failed its check after merge" --body-file -)" \
    || revert_failed "could not open the revert pull request"
  rpr="${rpr_url##*/}"
  log "opened $rpr_url"

  merge_gate "$rpr" revert || revert_failed "the gate refused the revert (#$rpr)"
  rsha="$(gh pr view "$rpr" --repo "$GH_REPO_SLUG" --json mergeCommit --jq .mergeCommit.oid 2>/dev/null || true)"
  [ -n "$rsha" ] || revert_failed "could not read the revert's merge commit"
  production_ok "$rsha" || revert_failed "production still fails after the revert"

  pr_comment "$pr" "Merged by the gate, then reverted by #$rpr: production failed its check after this merge. Production passes again after the revert."
  git checkout main >/dev/null 2>&1 || true
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  OWNS_BRANCH=0
  log "=== #$pr was merged, broke production, and was reverted by #$rpr; production is healthy ==="
  exit 71
}

if merge_gate "$PR_NUM" task; then
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$STAMP" >"$STATE_DIR/last-merge"
  MERGED_SHA="$(gh pr view "$PR_NUM" --repo "$GH_REPO_SLUG" --json mergeCommit --jq .mergeCommit.oid 2>/dev/null || true)"
  if [ -n "$MERGED_SHA" ] && production_ok "$MERGED_SHA"; then
    git checkout main >/dev/null 2>&1 || true
    git branch -D "$BRANCH" >/dev/null 2>&1 || true
    OWNS_BRANCH=0
    log "=== done: #$PR_NUM merged and production is healthy ==="
    exit 0
  fi
  [ -n "$MERGED_SHA" ] || log "could not read the merge commit of #$PR_NUM"
  revert_merge "$PR_NUM" "${MERGED_SHA:-unknown}"
fi

git checkout main >/dev/null 2>&1 || true
log "=== done: #$PR_NUM is open for a person ==="
exit 0

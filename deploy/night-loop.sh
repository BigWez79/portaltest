# night-loop.sh — how one night decides what to do next, and when to stop.
#
# Sourced by overnight.sh, and by scripts/test-night-loop.sh and
# scripts/test-merge-gate.sh, which exercise these functions rather than a
# copy of them (CLAUDE.md rule 12). Needs task-headings.sh sourced first.
#
# Everything that talks to git, gh or claude lives in overnight.sh. What is
# here decides from text and numbers alone, so it can be tested without any of
# them:
#
#   queue_status        which task is eligible, and why the others are not
#   night_window        when a night stops starting tasks, and when it ends
#   stop_reason         whether the loop stops before the next task
#   night_loop          the loop itself, driving hooks the caller defines
#   planner_check       whether a planner branch only queued roadmap work
#   already_started_today / mark_started   the catch-up's once-a-day rule
#   outcome_for_exit    what a build's exit code means for the loop
#   action_for_pr       the exact thing Wesley does to move a pull request on
#
# Written for bash 3.2, which is what /usr/bin/env bash finds under launchd on
# this Mac: no associative arrays, no ${x,,}, and never an empty "${a[@]}"
# under set -u.

# --------------------------------------------------------------------------
# The queue.
# --------------------------------------------------------------------------

# The lines of one task, its heading to the next ### or ## (TASKS.md on stdin).
task_block() {
  awk -v id="$1" '
    /^## / { inb = 0 }
    /^### / { inb = ($0 ~ ("^### " id "([^0-9]|$)")) }
    inb { print }'
}

# Every T-n mentioned under a heading matching REGEX (TASKS.md on stdin).
_ids_in_section() {
  awk -v re="$1" '/^## /{ins = ($0 ~ re)} ins {
    s = $0
    while (match(s, /(^|[^A-Za-z0-9-])T-[0-9]+/)) {
      t = substr(s, RSTART, RLENGTH); sub(/^[^T]/, "", t); print t
      s = substr(s, RSTART + RLENGTH)
    }
  }' | sort -u
}

# IDs a person has put under "## Held". A task that is also still under Next
# up is not picked: Held wins, because the cost of the other reading is a night
# spent on something Wesley said to leave.
held_ids() { _ids_in_section '^## Held'; }

# The T-n a task waits for, from lines like "After T-3" or "**After:** T-3, T-4"
# (one task's block on stdin).
task_deps() {
  awk '/^[[:space:]]*[*_]*After[*_:]*[[:space:]]+[*_]*T-[0-9]+/ {
    s = $0
    while (match(s, /T-[0-9]+/)) { print substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH) }
  }' | sort -u
}

# queue_status TASKS CLAIMS TRIED — one line per Next up task, in reading order:
#   T-2 eligible
#   T-1 open #53            an open pull request is building it
#   T-4 waits T-1           an After dependency is not in Done on main yet
#   T-5 held                a person put it under Held
#   T-6 tried               this night already attempted it
# CLAIMS is "T-n #pr" lines (claimed_task_ids). TRIED is IDs separated by spaces.
queue_status() {
  local tasks="$1" claims="$2" tried="$3" done held id prs dep waiting
  done="$(printf '%s\n' "$tasks" | done_ids)"
  held="$(printf '%s\n' "$tasks" | held_ids)"
  for id in $(printf '%s\n' "$tasks" | next_up_ids); do
    case " $tried " in *" $id "*) echo "$id tried"; continue ;; esac
    if printf '%s\n' "$held" | grep -qxF "$id"; then echo "$id held"; continue; fi
    prs="$(printf '%s\n' "$claims" | awk -v id="$id" '$1 == id { print $2 }' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
    if [ -n "$prs" ]; then echo "$id open $prs"; continue; fi
    waiting=""
    for dep in $(printf '%s\n' "$tasks" | task_block "$id" | task_deps); do
      printf '%s\n' "$done" | grep -qxF "$dep" || waiting="$waiting $dep"
    done
    if [ -n "$waiting" ]; then echo "$id waits$waiting"; continue; fi
    echo "$id eligible"
  done
}

eligible_ids() { printf '%s\n' "$1" | awk '$2 == "eligible" { print $1 }'; }

# The highest T-n anywhere in the text given, or 0.
max_task_number() {
  { printf '%s\n' "$@" | grep -Eo 'T-[0-9]+' | sed 's/^T-//'; echo 0; } | sort -n | tail -1
}

# --------------------------------------------------------------------------
# The roadmap. docs/ROADMAP.md is Wesley's, and a protected path: the machine
# reads it and never writes it. Items are "### R-n — Title" under
# "## Ready to build" (the planner may queue them) or "## Needs Wesley first"
# (it may not). A "Status: DRAFT" line anywhere makes the planner refuse all of
# it: a draft is Claude's reading of the backlog, not Wesley's list.
# --------------------------------------------------------------------------
roadmap_is_draft() { printf '%s\n' "$1" | grep -q '^Status: *DRAFT'; }

roadmap_ready_ids() {
  printf '%s\n' "$1" | awk '/^## /{inr = ($0 ~ /^## Ready to build/)} inr && /^### R-[0-9]+/ {
    match($0, /R-[0-9]+/); print substr($0, RSTART, RLENGTH)
  }'
}

# roadmap_item ROADMAP R-n — the item's lines, heading to the next ### or ##.
roadmap_item() {
  printf '%s\n' "$1" | awk -v id="$2" '
    /^## / { inb = 0 }
    /^### / { inb = ($0 ~ ("^### " id "([^0-9]|$)")) }
    inb { print }'
}

roadmap_title() { roadmap_item "$1" "$2" | head -1 | sed 's/^### *//'; }

# R-n that some task in TASKS.md (Next up or Done) already came from.
sourced_roadmap_ids() {
  grep -Eo '^Source: *ROADMAP *(—|-)+ *R-[0-9]+' | grep -Eo 'R-[0-9]+' | sort -u
}

# Every Source: line ever added to TASKS.md on REF. A finished task becomes a
# one-line Done entry and its Source: line goes with it, so TASKS.md alone
# forgets which roadmap items were queued; the history does not. (Found by
# simulating a night on 30 September: R-1 would have been queued twice.)
roadmap_used_history() {
  git log "${1:-origin/main}" -p --format= -- TASKS.md 2>/dev/null | sed -n 's/^+\(Source:.*\)/\1/p'
}

# roadmap_unplanned ROADMAP TASKS [HISTORY] — Ready items no task has come
# from yet, in TASKS.md or ever (HISTORY is roadmap_used_history).
roadmap_unplanned() {
  local done_r id
  done_r="$(printf '%s\n%s\n' "$2" "${3:-}" | sourced_roadmap_ids)"
  for id in $(roadmap_ready_ids "$1"); do
    printf '%s\n' "$done_r" | grep -qxF "$id" || echo "$id"
  done
}

# --------------------------------------------------------------------------
# planner_check — did a planner branch only queue work the roadmap asked for?
# The same function decides for the gate (plan mode) and for the planner's own
# look before it opens a pull request.
#
# Inputs (set before calling): G_NAMES, G_TASKS_BASE, G_TASKS_HEAD and
# G_TASKS_DELETED from gate_collect; G_ROADMAP, docs/ROADMAP.md as it is on
# main; G_ROADMAP_USED, roadmap_used_history of main; G_FIX_REFS, the pull
# request numbers that failed tonight, space separated. Sets PLAN_PROBLEMS, one per line; returns 0 when there are none.
# --------------------------------------------------------------------------
PLAN_MAX_ROADMAP=3
PLAN_MAX_FIX=2

planner_check() {
  PLAN_PROBLEMS=""
  _pp() { PLAN_PROBLEMS="${PLAN_PROBLEMS}$*
"; }
  local names base_max head_ids added ready used_r n_r=0 n_f=0 id block src r pr

  if [ -z "${G_ROADMAP:-}" ]; then
    _pp "there is no docs/ROADMAP.md on main"
  elif roadmap_is_draft "$G_ROADMAP"; then
    _pp "docs/ROADMAP.md is still marked DRAFT"
  fi

  names="$(printf '%s\n' "${G_NAMES:-}" | sed '/^$/d')"
  [ "$names" = "TASKS.md" ] || _pp "a planner branch changes only TASKS.md, and this one changes: $(printf '%s' "$names" | tr '\n' ' ')"
  [ "${G_TASKS_DELETED:-1}" = "0" ] || _pp "the planner only adds; this branch removes or rewrites ${G_TASKS_DELETED:-?} line(s) of TASKS.md"

  if [ "$(printf '%s\n' "$G_TASKS_BASE" | done_ids)" != "$(printf '%s\n' "$G_TASKS_HEAD" | done_ids)" ]; then
    _pp "the planner may not change what is in Done"
  fi

  base_max="$(max_task_number "$G_TASKS_BASE")"
  head_ids="$(printf '%s\n' "$G_TASKS_HEAD" | next_up_ids)"
  added=""
  for id in $head_ids; do
    printf '%s\n' "$G_TASKS_BASE" | next_up_ids | grep -qxF "$id" && continue
    if printf '%s\n' "$G_TASKS_BASE" | grep -Eq "(^|[^A-Za-z0-9-])$id([^0-9]|\$)"; then
      _pp "$id is already used in TASKS.md; an ID is never reused"
      continue
    fi
    [ "${id#T-}" -gt "$base_max" ] || _pp "$id is not above the highest ID in use (T-$base_max)"
    added="$added $id"
  done
  [ -n "$added" ] || _pp "the branch adds no task"

  ready="$(roadmap_ready_ids "${G_ROADMAP:-}")"
  used_r="$(printf '%s\n%s\n' "$G_TASKS_BASE" "${G_ROADMAP_USED:-}" | sourced_roadmap_ids)"
  for id in $added; do
    block="$(printf '%s\n' "$G_TASKS_HEAD" | task_block "$id")"
    src="$(printf '%s\n' "$block" | grep -E '^Source:' || true)"
    if [ -z "$src" ]; then
      _pp "$id has no Source: line — the planner may only queue roadmap items and tonight's fixes"
      continue
    fi
    if [ "$(printf '%s\n' "$src" | wc -l | tr -d ' ')" != "1" ]; then
      _pp "$id has more than one Source: line"
      continue
    fi
    if printf '%s\n' "$src" | grep -Eq '^Source: *ROADMAP *(—|-)+ *R-[0-9]+([^0-9]|$)'; then
      r="$(printf '%s\n' "$src" | grep -Eo 'R-[0-9]+' | head -1)"
      if ! printf '%s\n' "$ready" | grep -qxF "$r"; then
        _pp "$id names $r, which is not under \"Ready to build\" in docs/ROADMAP.md"
      elif printf '%s\n' "$used_r" | grep -qxF "$r"; then
        _pp "$id names $r, which already has a task"
      else
        used_r="$used_r
$r"
        n_r=$((n_r + 1))
      fi
    elif printf '%s\n' "$src" | grep -Eq '^Source: *FIX *(—|-)+ *#[0-9]+([^0-9]|$)'; then
      pr="$(printf '%s\n' "$src" | grep -Eo '#[0-9]+' | head -1 | tr -d '#')"
      case " ${G_FIX_REFS:-} " in
        *" $pr "*) n_f=$((n_f + 1)) ;;
        *) _pp "$id is a fix for #$pr, which did not fail tonight" ;;
      esac
    else
      _pp "$id's source is neither \"ROADMAP — R-n\" nor \"FIX — #n\": $src"
    fi
    printf '%s\n' "$block" | grep -Eq '^[*_]*Done when' || _pp "$id has no \"Done when\" line"
    printf '%s\n' "$block" | grep -Eq '^Size: *(S|M|L)([^A-Za-z]|$)' || _pp "$id has no \"Size: S|M|L\" line"
  done
  [ "$n_r" -le "$PLAN_MAX_ROADMAP" ] || _pp "$n_r roadmap items queued; at most $PLAN_MAX_ROADMAP a time"
  [ "$n_f" -le "$PLAN_MAX_FIX" ] || _pp "$n_f fixes queued; at most $PLAN_MAX_FIX a time"

  [ -z "$PLAN_PROBLEMS" ]
}

# --------------------------------------------------------------------------
# Time. A night started before 06:00 starts no task after 06:00 and is over by
# 07:00. A catch-up (started later, after a restart) gets the same three hours
# and one hour's grace, counted from when it started.
#
# night_window START_EPOCH START_SECONDS_SINCE_MIDNIGHT -> "CUTOFF HARD_STOP"
# Taking seconds since midnight rather than parsing a date keeps this the same
# on BSD date (this Mac) and GNU date (CI). The clocks change at 01:00/02:00,
# before any night starts, so the wall clock after 03:00 is continuous.
# --------------------------------------------------------------------------
NIGHT_CUTOFF_SOD=$((6 * 3600))

night_window() {
  local start="$1" sod="$2" cutoff
  if [ "$sod" -lt "$NIGHT_CUTOFF_SOD" ]; then
    cutoff=$((start + NIGHT_CUTOFF_SOD - sod))
  else
    cutoff=$((start + 3 * 3600))
  fi
  echo "$cutoff $((cutoff + 3600))"
}

# --------------------------------------------------------------------------
# The once-a-day rule for the catch-up. The overnight job fires at 03:00, at
# 12:30 and whenever it is loaded (a login after a restart). Only the first of
# those that gets past the preflight does anything. The caller holds the run
# lock while it asks and marks, so two fires cannot both see "not yet".
# --------------------------------------------------------------------------
already_started_today() { [ "$(cat "$1" 2>/dev/null || true)" = "$2" ]; }

mark_started() {
  mkdir -p "$(dirname "$1")" && printf '%s\n' "$2" >"$1.tmp" && mv "$1.tmp" "$1"
}

# --------------------------------------------------------------------------
# What a build's exit code means for the loop. RESULT is what the build wrote
# about itself before exiting (merged, held, blocked, nothing, or empty).
#
#   merged | held | blocked      the loop goes on; the failure run resets
#   failed                       the loop goes on; two in a row stop it
#   reverted                     stop: production broke tonight
#   rate-limited                 stop: Claude said no, and asking again is the loop
#   stop                         stop: the tree or the lock is not as it must be
# --------------------------------------------------------------------------
outcome_for_exit() {
  local rc="$1" result="${2:-}"
  case "$rc" in
    0)
      case "$result" in
        merged|held|blocked) echo "$result" ;;
        *) echo failed ;;
      esac ;;
    71|72) echo reverted ;;
    75)    echo rate-limited ;;
    64|65|66) echo stop ;;
    *)     echo failed ;;
  esac
}

# A usage or rate limit in the last lines of an agent transcript. Distinct from
# overloaded/5xx (transient, one retry): a limit does not lift in five minutes,
# and retrying it is the retry loop this is here to prevent.
is_rate_limited() {
  tail -60 "$1" 2>/dev/null | grep -Eiq 'usage limit|rate[ _-]?limit|limit reached|limit will reset|resets? at [0-9]|too many requests|(^|[^0-9])429([^0-9]|$)|out of (extra )?usage|credit balance is too low'
}

# --------------------------------------------------------------------------
# stop_reason — empty, or why the loop must not start another task. Reads:
#   LOOP_NOW LOOP_CUTOFF LOOP_ATTEMPTED LOOP_MAX LOOP_FAILS_IN_ROW
#   LOOP_REVERTED LOOP_RATE_LIMITED KILL_SWITCH MERGE_MARKER
# --------------------------------------------------------------------------
stop_reason() {
  if [ "${LOOP_RATE_LIMITED:-0}" = "1" ]; then echo "Claude reported a usage or rate limit"; return; fi
  if [ "${LOOP_REVERTED:-0}" = "1" ]; then echo "a revert happened: production failed its check after a merge"; return; fi
  if [ -n "${KILL_SWITCH:-}" ] && [ -e "$KILL_SWITCH" ]; then echo "the kill switch is on ($KILL_SWITCH)"; return; fi
  if [ -n "${MERGE_MARKER:-}" ] && [ -e "$MERGE_MARKER" ]; then echo "a merge was never confirmed healthy in production ($(cat "$MERGE_MARKER" 2>/dev/null))"; return; fi
  if [ "${LOOP_FAILS_IN_ROW:-0}" -ge 2 ]; then echo "2 tasks in a row failed"; return; fi
  if [ "${LOOP_ATTEMPTED:-0}" -ge "${LOOP_MAX:-6}" ]; then echo "${LOOP_MAX:-6} tasks attempted"; return; fi
  if [ "${LOOP_NOW:-0}" -ge "${LOOP_CUTOFF:-0}" ]; then echo "it is past $(_hhmm "${LOOP_CUTOFF:-0}") — no new task starts after it"; return; fi
}

_hhmm() { date -r "$1" '+%H:%M' 2>/dev/null || date -d "@$1" '+%H:%M' 2>/dev/null || echo "the cutoff"; }

# --------------------------------------------------------------------------
# night_loop — the loop. The caller defines these hooks; overnight.sh's do the
# work, the test's pretend to:
#
#   loop_now                 prints the time, epoch seconds
#   loop_refresh             fetch main and read the queue: sets LOOP_TASKS
#                            (TASKS.md on main) and LOOP_CLAIMS; non-zero if
#                            it cannot, which stops the night
#   loop_build ID            one task, start to finish, merge and production
#                            check included; sets LOOP_OUTCOME (as
#                            outcome_for_exit), LOOP_PR and LOOP_NOTE
#   loop_plan                the planner; sets LOOP_PLAN (merged, refused,
#                            failed, exhausted, draft, rate-limited, reverted),
#                            LOOP_PR and LOOP_NOTE, and LOOP_PLAN_ROADMAP_EMPTY=1
#                            when the roadmap had no Ready item left (it may
#                            still have tried fixes)
#
# Strictly one at a time: loop_build returns only after its merge (if any) has
# deployed and been smoke-tested, and the next task is not started while
# MERGE_MARKER — written before a merge, removed after production passes —
# still exists (stop_reason).
#
# Leaves LOOP_STOP (why it stopped) and LOOP_RESULTS ("ID|outcome|pr|note"
# lines, the planner as "plan").
# --------------------------------------------------------------------------
night_loop() {
  LOOP_ATTEMPTED=0 LOOP_FAILS_IN_ROW=0 LOOP_TRIED="" LOOP_STOP="" LOOP_RESULTS=""
  LOOP_PLANS=0 LOOP_PLAN_BLOCKED=0 LOOP_ROADMAP_DONE="" LOOP_REVERTED=0 LOOP_RATE_LIMITED=0
  LOOP_FIX_REFS="" LOOP_QUEUE=""
  local status eligible n id reason
  while :; do
    LOOP_NOW="$(loop_now)"
    reason="$(stop_reason)"
    if [ -n "$reason" ]; then LOOP_STOP="$reason"; break; fi

    if ! loop_refresh; then
      LOOP_STOP="could not bring main up to date, or read the queue${LOOP_NOTE:+: $LOOP_NOTE}"
      break
    fi
    status="$(queue_status "$LOOP_TASKS" "$LOOP_CLAIMS" "$LOOP_TRIED")"
    LOOP_QUEUE="$status"
    eligible="$(eligible_ids "$status")"
    n="$(printf '%s\n' "$eligible" | sed '/^$/d' | wc -l | tr -d ' ')"

    # Fewer than two left: ask the planner for more, from the roadmap only.
    if [ "$n" -lt 2 ] && [ "$LOOP_PLANS" -lt 2 ] && [ "$LOOP_PLAN_BLOCKED" = "0" ] && [ -z "$LOOP_ROADMAP_DONE" ]; then
      LOOP_PLAN="" LOOP_PR="" LOOP_NOTE="" LOOP_PLAN_ROADMAP_EMPTY=0
      loop_plan
      LOOP_PLANS=$((LOOP_PLANS + 1))
      # Fixes are planned once; with nothing Ready left, the planner is done.
      [ "$LOOP_PLAN_ROADMAP_EMPTY" = "1" ] && LOOP_ROADMAP_DONE="roadmap exhausted — needs Wesley"
      case "$LOOP_PLAN" in
        merged)       LOOP_RESULTS="${LOOP_RESULTS}plan|merged|${LOOP_PR}|${LOOP_NOTE}
"; continue ;;
        exhausted)    LOOP_ROADMAP_DONE="roadmap exhausted — needs Wesley" ;;
        draft)        LOOP_ROADMAP_DONE="roadmap exhausted — needs Wesley (docs/ROADMAP.md is still marked DRAFT)" ;;
        rate-limited) LOOP_RATE_LIMITED=1; LOOP_RESULTS="${LOOP_RESULTS}plan|rate-limited||${LOOP_NOTE}
"; continue ;;
        reverted)     LOOP_REVERTED=1; LOOP_RESULTS="${LOOP_RESULTS}plan|reverted|${LOOP_PR}|${LOOP_NOTE}
"; continue ;;
        *)            LOOP_PLAN_BLOCKED="${LOOP_PLAN:-failed}"; LOOP_RESULTS="${LOOP_RESULTS}plan|${LOOP_PLAN:-failed}|${LOOP_PR}|${LOOP_NOTE}
" ;;
      esac
    fi

    if [ "$n" -eq 0 ]; then
      if [ -n "$LOOP_ROADMAP_DONE" ]; then
        LOOP_STOP="$LOOP_ROADMAP_DONE"
      elif [ "$LOOP_PLAN_BLOCKED" = "refused" ]; then
        LOOP_STOP="no eligible task left, and the planner's pull request is waiting for Wesley"
      elif [ "$LOOP_PLAN_BLOCKED" != "0" ]; then
        LOOP_STOP="no eligible task left, and the planner failed — see the report"
      else
        LOOP_STOP="no eligible task left"
      fi
      break
    fi

    id="$(printf '%s\n' "$eligible" | head -1)"
    LOOP_TRIED="$LOOP_TRIED $id"
    LOOP_ATTEMPTED=$((LOOP_ATTEMPTED + 1))
    LOOP_OUTCOME="" LOOP_PR="" LOOP_NOTE=""
    loop_build "$id"
    LOOP_RESULTS="${LOOP_RESULTS}${id}|${LOOP_OUTCOME:-failed}|${LOOP_PR}|${LOOP_NOTE}
"
    case "${LOOP_OUTCOME:-failed}" in
      merged|held|blocked) LOOP_FAILS_IN_ROW=0 ;;
      reverted)            LOOP_REVERTED=1 ;;
      rate-limited)        LOOP_RATE_LIMITED=1 ;;
      stop)                LOOP_STOP="${LOOP_NOTE:-the working tree or the lock was not as the next task needs it}"; break ;;
      *)                   LOOP_FAILS_IN_ROW=$((LOOP_FAILS_IN_ROW + 1))
                           [ -n "$LOOP_PR" ] && LOOP_FIX_REFS="$LOOP_FIX_REFS ${LOOP_PR#\#}" ;;
    esac
  done
}

# --------------------------------------------------------------------------
# The report's NEEDS WESLEY line for one open pull request — the exact action.
# action_for_pr URL DRAFT(true|false) CHANGED_LINES FILES(newline list)
# Needs PROTECTED_PATHS and gate_is_protected (merge-gate.sh).
# --------------------------------------------------------------------------
action_for_pr() {
  local url="$1" draft="$2" lines="$3" files="$4" f migrations="" protected="" out why=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      supabase/migrations/*.sql) migrations="$migrations $f" ;;
      *) gate_is_protected "$f" && protected="$protected $f" ;;
    esac
  done <<EOF
$files
EOF
  if [ "$draft" = "true" ]; then
    echo "look at draft $url — verify failed or the run did not finish; fix it and mark it ready, or close it so its task can be built again"
    return
  fi
  out=""
  for f in $migrations; do
    out="${out}apply $(basename "$f") in the Supabase SQL editor, then "
  done
  [ -n "$protected" ] && why="touches protected paths:$(printf '%s\n' $protected | head -3 | sed 's/^/ /' | tr -d '\n')"
  if [ "${lines:-0}" -ge "${GATE_MAX_LINES:-800}" ] 2>/dev/null; then
    why="${why:+$why; }about $lines changed lines, over the ${GATE_MAX_LINES:-800} limit"
  fi
  echo "${out}review and merge $url${why:+ ($why)}"
}

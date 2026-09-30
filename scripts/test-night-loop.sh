#!/bin/bash
#
# Does the night keep going when it should, and stop when it must?
#
# Sources the real deploy/night-loop.sh and drives the real night_loop with
# pretend hooks: loop_build and loop_plan say what happened without building
# anything, loop_now is a clock the cases move, and loop_refresh hands back a
# TASKS.md the case controls. So what is tested is the loop's own arithmetic —
# eligibility, dependencies, the stop conditions, one merge at a time — and
# not a copy of it (CLAUDE.md rule 12).
#
# What is NOT exercised here: git, gh, claude, the gate's merge and the
# production check. The gate is scripts/test-merge-gate.sh; the catch-up is
# scripts/test-catch-up.sh, which runs overnight.sh itself.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=deploy/task-headings.sh
. "$HERE/deploy/task-headings.sh"
# shellcheck source=deploy/night-loop.sh
. "$HERE/deploy/night-loop.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/night-loop.XXXXXX")" || { echo "mktemp failed"; exit 1; }
[ -n "$WORK" ] && [ -d "$WORK" ] || { echo "no scratch directory"; exit 1; }
trap 'rm -rf "$WORK"' EXIT
KILL_SWITCH="$WORK/automerge-off"
MERGE_MARKER="$WORK/merge-in-flight"

# 03:00 on some night, as epoch seconds. Only differences matter.
T0=1000000000
SOD_0300=$((3 * 3600))

# --------------------------------------------------------------------------
# The pretend world.
#
#   QUEUE        TASKS.md as main has it; a merged task moves to Done in it
#   OUTCOMES     "T-n=outcome" lines: what building each task does (default held)
#   CLAIMS       "T-n #pr" lines, open pull requests from earlier nights
#   PLAN_RESULT  what the planner does (default exhausted)
#   STEP         seconds the clock moves per task
#   EVENTS       what happened, in order, for the cases to read
# --------------------------------------------------------------------------
reset_world() {
  QUEUE="" OUTCOMES="" CLAIMS="" PLAN_RESULT="exhausted" PLAN_ADDS=""
  STEP=600 NOW="$T0" EVENTS="" KILL_AFTER="" LEAVE_MARKER=""
  rm -f "$KILL_SWITCH" "$MERGE_MARKER"
  read -r LOOP_CUTOFF _hard <<<"$(night_window "$T0" "$SOD_0300")"
  LOOP_MAX=6
}

queue_of() {  # queue_of "T-1" "T-2|After T-1" ... — a TASKS.md with these under Next up
  local t id extra
  printf '# Queue\n\n## Next up — new work\n\n'
  for t in "$@"; do
    id="${t%%|*}"; extra=""; [ "$t" != "$id" ] && extra="${t#*|}"
    printf '### %s — Task %s\n\n%s\n\nDo it.\n\n' "$id" "$id" "$extra"
  done
  printf '## Held — needs a person\n\n## Done\n\n- **T-0 — Long ago** — `x`\n'
}

loop_now() { echo "$NOW"; }
loop_refresh() { LOOP_TASKS="$QUEUE"; LOOP_CLAIMS="$CLAIMS"; return 0; }

loop_build() {
  local id="$1" out
  EVENTS="${EVENTS}start $id
"
  # One at a time, observed: nothing may start while a merge is unconfirmed.
  [ -e "$MERGE_MARKER" ] && EVENTS="${EVENTS}OVERLAP $id
"
  out="$(printf '%s\n' "$OUTCOMES" | sed -n "s/^$id=//p" | head -1)"
  out="${out:-held}"
  NOW=$((NOW + STEP))
  if [ "$out" = "merged" ]; then
    # What overnight.sh does: marker before the merge, removed by a passing
    # production check. LEAVE_MARKER plays a production check that never
    # confirmed (a crash mid-deploy).
    echo "#9 merged" >"$MERGE_MARKER"
    QUEUE="$(printf '%s\n' "$QUEUE" | awk -v id="$id" '
      /^### / { skip = ($0 ~ ("^### " id "([^0-9]|$)")) }
      /^## / { skip = 0 }
      !skip { print }
      /^## Done/ { print ""; print "- **" id " — merged** — `b`" }')"
    [ -n "$LEAVE_MARKER" ] || rm -f "$MERGE_MARKER"
  fi
  [ "$id" = "$KILL_AFTER" ] && touch "$KILL_SWITCH"
  EVENTS="${EVENTS}end $id $out
"
  LOOP_OUTCOME="$out" LOOP_PR="${id#T-}" LOOP_NOTE=""
}

loop_plan() {
  EVENTS="${EVENTS}plan
"
  LOOP_PLAN="$PLAN_RESULT" LOOP_PR="" LOOP_NOTE="" LOOP_PLAN_ROADMAP_EMPTY="${PLAN_ROADMAP_EMPTY:-0}"
  if [ "$PLAN_RESULT" = "merged" ]; then
    local t
    for t in $PLAN_ADDS; do
      QUEUE="$(printf '%s\n' "$QUEUE" | awk -v t="$t" '/^## Held/ { print "### " t " — Planned\n\nSource: ROADMAP — R-1 — x\n" } { print }')"
    done
    PLAN_ADDS="" PLAN_RESULT="exhausted"
  fi
}

started() { printf '%s' "$EVENTS" | awk '$1 == "start" { print $2 }' | paste -sd ' ' -; }

failed=0
check() {  # check NAME WANT GOT
  if [ "$2" = "$3" ]; then
    printf '  ok    %-48s %s\n' "$1" "$3"
  else
    printf '  FAIL  %-48s wanted "%s", got "%s"\n' "$1" "$2" "$3"
    failed=1
  fi
}
check_stop() {  # check_stop NAME TEXT-THE-STOP-REASON-MUST-CONTAIN
  case "$LOOP_STOP" in
    *"$2"*) printf '  ok    %-48s stopped: %s\n' "$1" "$LOOP_STOP" ;;
    *) printf '  FAIL  %-48s wanted a stop saying "%s", got "%s"\n' "$1" "$2" "$LOOP_STOP"; failed=1 ;;
  esac
}

printf 'The night loop:\n'

# Rule 12, one line each — what would have to be true for the case to pass wrongly.

# --- every stop condition ---------------------------------------------------

#   no eligible task: queue_status would have to call an open-PR task eligible, which the next case rules out.
reset_world; QUEUE="$(queue_of T-1 T-2)"
night_loop
check      "stop: no eligible task left — all built"       "T-1 T-2" "$(started)"
check_stop "stop: no eligible task left — reason"          "roadmap exhausted — needs Wesley"

#   06:00: loop_now would have to be ignored — the clock here is the only clock the loop reads.
reset_world; QUEUE="$(queue_of T-1 T-2 T-3 T-4 T-5)"; STEP=4000
night_loop
check      "stop: 06:00 — no task starts after it"         "T-1 T-2 T-3" "$(started)"
check_stop "stop: 06:00 — reason"                          "no new task starts after it"
#   07:00: night_window would have to put the hard stop somewhere other than an hour after the cutoff.
read -r c h <<<"$(night_window "$T0" "$SOD_0300")"
check      "window from 03:00: cutoff 06:00, hard stop 07:00" "10800 14400" "$((c - T0)) $((h - T0))"
read -r c h <<<"$(night_window "$T0" $((12 * 3600 + 30 * 60)))"
check      "window from a 12:30 catch-up: 3h, then 1h"     "10800 14400" "$((c - T0)) $((h - T0))"

#   6 attempted: LOOP_MAX would have to be ignored, or the count to skip a task that was held.
reset_world; QUEUE="$(queue_of T-1 T-2 T-3 T-4 T-5 T-6 T-7 T-8)"; STEP=60
night_loop
check      "stop: 6 tasks attempted — count"               "6" "$LOOP_ATTEMPTED"
check_stop "stop: 6 tasks attempted — reason"              "6 tasks attempted"

#   2 failures in a row: the count would have to reset on a failure, or not reset on a success (next case).
reset_world; QUEUE="$(queue_of T-1 T-2 T-3 T-4)"; OUTCOMES="$(printf 'T-1=failed\nT-2=failed')"
night_loop
check      "stop: 2 failures in a row — attempts"          "T-1 T-2" "$(started)"
check_stop "stop: 2 failures in a row — reason"            "2 tasks in a row failed"
reset_world; QUEUE="$(queue_of T-1 T-2 T-3 T-4)"; OUTCOMES="$(printf 'T-1=failed\nT-2=held\nT-3=failed')"
night_loop
check      "failures not in a row do not stop it"          "T-1 T-2 T-3 T-4" "$(started)"

#   kill switch: stop_reason would have to look at a different path from KILL_SWITCH.
reset_world; QUEUE="$(queue_of T-1 T-2 T-3)"; KILL_AFTER=T-1
night_loop
check      "stop: kill switch turned on mid-night"         "T-1" "$(started)"
check_stop "stop: kill switch — reason"                    "kill switch is on"
reset_world; QUEUE="$(queue_of T-1)"; touch "$KILL_SWITCH"
night_loop
check      "stop: kill switch already on — nothing starts" "" "$(started)"

#   revert: outcome_for_exit would have to map 71 or 72 to something other than reverted.
reset_world; QUEUE="$(queue_of T-1 T-2)"; OUTCOMES="T-1=$(outcome_for_exit 71 merged)"
night_loop
check      "stop: a revert happened (exit 71)"             "T-1" "$(started)"
check_stop "stop: a revert — reason"                       "a revert happened"
check      "exit 72 is a revert too"                       "reverted" "$(outcome_for_exit 72 merged)"

#   rate limit: 75 would have to map to failed (which keeps going), or the loop to try the task again.
reset_world; QUEUE="$(queue_of T-1 T-2)"; OUTCOMES="T-1=$(outcome_for_exit 75 rate-limited)"
night_loop
check      "stop: usage or rate limit — no retry, no next" "T-1" "$(started)"
check_stop "stop: rate limit — reason"                     "usage or rate limit"
#   is_rate_limited would have to miss the CLI's own wording, or match an ordinary transcript.
printf 'working...\nClaude AI usage limit reached|1759200000\n' >"$WORK/limited.log"
printf 'working...\nAll 319 tests passed. Committed.\n' >"$WORK/fine.log"
printf 'API Error: 529 {"type":"overloaded_error"}\n' >"$WORK/overloaded.log"
check      "rate limit detected in a transcript"           "yes" "$(is_rate_limited "$WORK/limited.log" && echo yes || echo no)"
check      "an ordinary transcript is not a rate limit"    "no" "$(is_rate_limited "$WORK/fine.log" && echo yes || echo no)"
check      "overloaded (transient) is not a rate limit"    "no" "$(is_rate_limited "$WORK/overloaded.log" && echo yes || echo no)"

#   roadmap exhausted: a planner that found nothing would have to be read as success.
reset_world; QUEUE="$(queue_of)"
night_loop
check      "roadmap exhausted — the planner was asked"     "plan" "$(printf '%s' "$EVENTS" | head -1)"
check_stop "stop: roadmap exhausted — reason"              "roadmap exhausted — needs Wesley"
reset_world; QUEUE="$(queue_of)"; PLAN_RESULT=draft
night_loop
check_stop "stop: a DRAFT roadmap counts as exhausted"     "DRAFT"

# --- a held task does not stop the night -------------------------------------

#   held: a held outcome would have to count as a failure, or its task to be retried.
reset_world; QUEUE="$(queue_of T-1 T-2 T-3)"; OUTCOMES="$(printf 'T-1=held\nT-2=held')"
night_loop
check      "held tasks do not stop the loop"               "T-1 T-2 T-3" "$(started)"
check      "a held task is not retried the same night"     "1" "$(printf '%s' "$EVENTS" | grep -c '^start T-1$')"
#   open PR from an earlier night: queue_status would have to ignore CLAIMS.
reset_world; QUEUE="$(queue_of T-1 T-2)"; CLAIMS="T-1 #53"
night_loop
check      "a task with an open PR (#53) is skipped"       "T-2" "$(started)"
#   Held section: held_ids would have to read outside "## Held".
reset_world; QUEUE="$(queue_of T-1 T-2 | awk '{ print } /^## Held/ { print ""; print "- T-1, until the migration is applied" }')"
check      "a task named under Held is not picked"         "T-1 held" "$(queue_status "$QUEUE" "" "" | sed -n 1p)"

# --- a dependency waits for its parent ----------------------------------------

#   dependency: task_deps would have to miss "After T-1", or done_ids to count a held PR as merged.
reset_world; QUEUE="$(queue_of T-1 'T-2|After T-1' T-3)"; OUTCOMES="T-1=held"
night_loop
check      "T-2 waits while T-1 is held; T-3 goes on"      "T-1 T-3" "$(started)"
check      "the report sees why T-2 waited"                "T-2 waits T-1" "$(printf '%s\n' "$LOOP_QUEUE" | grep '^T-2')"
reset_world; QUEUE="$(queue_of T-1 'T-2|**After:** T-1' T-3)"; OUTCOMES="T-1=merged"
night_loop
check      "T-2 is built once T-1 has merged"              "T-1 T-2 T-3" "$(started)"
reset_world; QUEUE="$(queue_of 'T-2|After T-1, T-9')"
check      "every parent must be merged, not just one"     "T-2 waits T-1 T-9" "$(queue_status "$QUEUE" "" "")"

# --- merges one at a time -----------------------------------------------------

#   one at a time: the loop would have to start a task while MERGE_MARKER exists. loop_build here
#   records OVERLAP if it ever does; overnight.sh removes the marker only after production passes.
reset_world; QUEUE="$(queue_of T-1 T-2 T-3)"; OUTCOMES="$(printf 'T-1=merged\nT-2=merged\nT-3=merged')"
night_loop
check      "three merges, strictly in turn"                "T-1 T-2 T-3" "$(started)"
check      "no task started while a merge was unconfirmed" "0" "$(printf '%s' "$EVENTS" | grep -c OVERLAP)"
reset_world; QUEUE="$(queue_of T-1 T-2)"; OUTCOMES="T-1=merged"; LEAVE_MARKER=1
night_loop
check      "an unconfirmed merge stops the night"          "T-1" "$(started)"
check_stop "an unconfirmed merge — reason"                 "never confirmed healthy"

# --- the planner --------------------------------------------------------------

#   planner: the loop would have to skip planning when fewer than two are eligible, or count the
#   planner as an attempt.
reset_world; QUEUE="$(queue_of T-1)"; PLAN_RESULT=merged; PLAN_ADDS="T-2 T-3"
night_loop
check      "one eligible: the planner runs first"          "plan" "$(printf '%s' "$EVENTS" | head -1)"
check      "then the planned tasks are built"              "T-1 T-2 T-3" "$(started)"
check      "the planner is not counted as an attempt"      "3" "$LOOP_ATTEMPTED"
reset_world; QUEUE="$(queue_of T-1 T-2)"
night_loop
check      "two eligible: the planner is not asked yet"    "start T-1" "$(printf '%s' "$EVENTS" | head -1)"
reset_world; QUEUE="$(queue_of T-1)"; PLAN_RESULT=refused
night_loop
check      "a refused plan does not stop the night"        "T-1" "$(started)"
check      "a refused plan is not retried"                 "1" "$(printf '%s' "$EVENTS" | grep -c '^plan$')"
check_stop "a refused plan — reason"                       "planner's pull request is waiting"
#   a failed plan: its reason would have to claim a pull request exists — the sim of 30 September did.
reset_world; QUEUE="$(queue_of)"; PLAN_RESULT=failed
night_loop
check_stop "a plan that failed its check — reason"         "the planner failed"
#   fixes tried with nothing Ready left: the night would have to blame the planner, not the roadmap.
reset_world; QUEUE="$(queue_of)"; PLAN_RESULT=failed; PLAN_ROADMAP_EMPTY=1
night_loop
check_stop "fixes tried, roadmap empty — reason"           "roadmap exhausted — needs Wesley"
PLAN_ROADMAP_EMPTY=0

# --- what an exit code means ----------------------------------------------------

#   outcome_for_exit would have to let a crash (0 with nothing written) read as a success.
check      "exit 0 with no result is a failure"            "failed" "$(outcome_for_exit 0 "")"
check      "exit 0, agent did nothing, is a failure"       "failed" "$(outcome_for_exit 0 nothing)"
check      "exit 69 (verify red, draft) is a failure"      "failed" "$(outcome_for_exit 69 "")"
check      "exit 64 (dirty tree) stops the night"          "stop" "$(outcome_for_exit 64 "")"

if [ "$failed" -ne 0 ]; then
  printf '\nThe night loop would decide wrongly.\n'
  exit 1
fi

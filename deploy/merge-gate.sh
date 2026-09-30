# merge-gate.sh — the decision whether the 03:00 run may merge its own pull
# request. Sourced by overnight.sh, and by scripts/test-merge-gate.sh, which
# exercises these functions rather than a copy of them (CLAUDE.md rule 12).
#
# Two halves, kept apart so the second can be tested without GitHub:
#
#   gate_collect BASE HEAD   reads git and fills the G_* diff inputs
#   gate_evaluate MODE       decides, from G_* alone, and prints why
#
# The GitHub-facing inputs (draft, checks) and the verify results are set by
# the caller. overnight.sh sources this file from its INSTALLED directory
# before it checks out anything, so a branch that edits this file cannot
# change the gate that judges it — and deploy/** is a protected path besides.
#
# Needs PROTECTED_PATHS (an array of globs, defined at the top of overnight.sh)
# and KILL_SWITCH (a path) to be set by whoever sources it, and night-loop.sh
# sourced for plan mode (planner_check).

# The size limit, excluding TASKS.md. A binary file counts as the whole limit on
# its own: its line count is unknown, and unknown is not small.
GATE_MAX_LINES="${GATE_MAX_LINES:-800}"

# A test file, for condition e.
gate_is_test_file() {
  case "$1" in
    tests/*|*.spec.ts|*.spec.tsx|*.test.ts|*.test.tsx|scripts/test-*) return 0 ;;
  esac
  return 1
}

# 0 when PATH matches one of PROTECTED_PATHS. `[[ == ]]` with an unquoted
# right-hand side is a glob in which `*` also matches `/`, so `supabase/*`
# covers everything under supabase/.
gate_is_protected() {
  local path="$1" pattern
  for pattern in "${PROTECTED_PATHS[@]}"; do
    # shellcheck disable=SC2053
    [[ "$path" == $pattern ]] && return 0
  done
  return 1
}

# gate_collect BASE HEAD — fill the diff-derived inputs. Three-dot, so the diff
# is what HEAD changed since it left BASE, not what BASE has gained since.
# --no-renames makes a rename appear as a delete plus an add: a test file moved
# out of tests/ is a deleted test, and a protected file renamed away still
# names the protected path.
gate_collect() {
  local base="$1" head="$2"
  G_NAMES="$(git diff --no-renames --name-only "$base...$head")"
  G_NAME_STATUS="$(git diff --no-renames --name-status "$base...$head")"
  G_NUMSTAT="$(git diff --no-renames --numstat "$base...$head")"
  G_TASKS_BASE="$(git show "$base:TASKS.md" 2>/dev/null || true)"
  G_TASKS_HEAD="$(git show "$head:TASKS.md" 2>/dev/null || true)"
  # Lines of TASKS.md removed or rewritten. A planner branch must have none.
  # From numstat, not by grepping the patch for "-": a deleted line that
  # itself starts with "-" (every Done entry, every checkbox) looks like "--".
  G_TASKS_DELETED="$(git diff --no-renames --numstat "$base...$head" -- TASKS.md | awk '{ d += $2 } END { print d + 0 }')"
  # Added lines in test files only, without the leading '+'.
  local f added=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    gate_is_test_file "$f" || continue
    added="$added$(git diff --no-renames "$base...$head" -- "$f" | sed -n 's/^+\([^+]\)/\1/p; s/^+$//p')
"
  done <<EOF
$G_NAMES
EOF
  G_TEST_ADDED="$added"
}

# gate_evaluate MODE — MODE is "task" (a night's work), "plan" (the planner
# queueing roadmap items in TASKS.md) or "revert" (undoing a merge that broke
# production). Prints one line per condition and sets
# GATE_FAILURES to the failed ones, one per line. Returns 0 only if every
# condition that was evaluated passed; a condition set to "skip" (the dry run
# has no PR and runs no verify) is shown and left out of the verdict.
#
# Inputs, all set before calling:
#   G_VERIFY_OK      1 | 0 | skip   local verify passed on the final commit
#   G_IS_DRAFT       1 | 0 | skip
#   G_CHECKS_OK      1 | 0 | skip   every GitHub check passed within the cap
#   G_TASK_ID        the ID this run was given (task mode)
#   G_PASSED_HEAD    passing tests on the final commit
#   G_PASSED_BASE    passing tests on main, measured before the agent ran
#   G_MERGE_IN_FLIGHT 1 if an earlier merge has not yet passed its production
#                    check (the marker file exists)
#   G_TIME_OK        1 | 0 | skip   enough of the night left to watch a deploy
#   G_ROADMAP, G_FIX_REFS           plan mode: see planner_check
#   G_REVERT_PATHS   revert mode: the paths the reverted merge touched
#   G_REVERT_EXACT   revert mode: 1 if those paths now match the pre-merge tree
#   plus G_NAMES, G_NAME_STATUS, G_NUMSTAT, G_TASKS_BASE, G_TASKS_HEAD and
#   G_TEST_ADDED from gate_collect.
gate_evaluate() {
  local mode="${1:-task}"
  GATE_FAILURES=""
  local verdict=0

  _gate_line() {  # _gate_line LETTER ok|FAIL|skip TEXT
    printf '  %-4s %s  %s\n' "$2" "$1" "$3"
    if [ "$2" = "FAIL" ]; then
      GATE_FAILURES="${GATE_FAILURES}$1) $3
"
      verdict=1
    fi
  }

  # a) verified locally, and not a draft. A planner branch changes TASKS.md
  #    and nothing else (c holds it to that), so it has nothing to verify
  #    locally; b still needs CI's verify, which main's protection requires.
  if [ "$mode" = "plan" ]; then
    if [ "${G_IS_DRAFT:-1}" = "1" ]; then
      _gate_line a FAIL "the pull request is a draft"
    else
      _gate_line a ok "not a draft (a TASKS.md-only planner branch is verified by CI, in b)"
    fi
  elif [ "${G_VERIFY_OK:-0}" = "skip" ]; then
    _gate_line a skip "local verify (not run in a dry run)"
  elif [ "${G_VERIFY_OK:-0}" != "1" ]; then
    _gate_line a FAIL "local npm run verify did not pass on the final commit"
  elif [ "${G_IS_DRAFT:-1}" = "1" ]; then
    _gate_line a FAIL "the pull request is a draft"
  else
    _gate_line a ok "local verify passed on the final commit; not a draft"
  fi

  # b) GitHub checks
  case "${G_CHECKS_OK:-0}" in
    skip) _gate_line b skip "GitHub checks (no pull request in a dry run)" ;;
    1)    _gate_line b ok "every GitHub check passed" ;;
    *)    _gate_line b FAIL "GitHub checks failed, or did not finish within the cap" ;;
  esac

  # c) exactly one task, moved to Done — or, for a revert, exactly the paths of
  #    the merge it undoes — or, for the planner, only roadmap items and
  #    tonight's fixes, added to TASKS.md and nothing else
  if [ "$mode" = "plan" ]; then
    if planner_check; then
      _gate_line c ok "the planner only added tasks from ROADMAP.md's Ready to build (or tonight's fixes)"
    else
      _gate_line c FAIL "$(printf '%s' "$PLAN_PROBLEMS" | sed '/^$/d' | paste -sd ';' - | sed 's/;/; /g')"
    fi
  elif [ "$mode" = "revert" ]; then
    local want got
    want="$(printf '%s\n' "$G_REVERT_PATHS" | sed '/^$/d' | sort -u)"
    got="$(printf '%s\n' "$G_NAMES" | sed '/^$/d' | sort -u)"
    if [ -z "$want" ] || [ "$want" != "$got" ]; then
      _gate_line c FAIL "the revert does not touch exactly the paths of the merge it undoes"
    else
      _gate_line c ok "the revert touches exactly the paths of the merge it undoes"
    fi
  else
    local base_ids head_ids removed added done_head
    base_ids="$(printf '%s\n' "$G_TASKS_BASE" | next_up_ids)"
    head_ids="$(printf '%s\n' "$G_TASKS_HEAD" | next_up_ids)"
    removed="$(comm -23 <(printf '%s\n' "$base_ids" | sed '/^$/d' | sort -u) <(printf '%s\n' "$head_ids" | sed '/^$/d' | sort -u))"
    added="$(comm -13 <(printf '%s\n' "$base_ids" | sed '/^$/d' | sort -u) <(printf '%s\n' "$head_ids" | sed '/^$/d' | sort -u))"
    done_head="$(printf '%s\n' "$G_TASKS_HEAD" | done_ids)"
    if [ -n "$added" ]; then
      _gate_line c FAIL "the branch adds tasks to Next up: $(printf '%s' "$added" | tr '\n' ' ')"
    elif [ "$(printf '%s\n' "$removed" | sed '/^$/d' | wc -l | tr -d ' ')" != "1" ]; then
      _gate_line c FAIL "the branch must take exactly one task out of Next up; it took: ${removed:-none}"
    elif ! printf '%s\n' "$done_head" | grep -qxF "$removed"; then
      _gate_line c FAIL "$removed left Next up but is not in Done"
    elif [ -n "${G_TASK_ID:-}" ] && [ "$removed" != "$G_TASK_ID" ]; then
      _gate_line c FAIL "the branch finished $removed, but this run was given $G_TASK_ID"
    else
      _gate_line c ok "exactly one task, $removed, moved to Done"
    fi
  fi

  # d) protected paths
  local p hits=""
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    gate_is_protected "$p" && hits="$hits $p"
  done <<EOF
$G_NAMES
EOF
  if [ -n "$hits" ]; then
    _gate_line d FAIL "touches protected paths:$hits"
  else
    _gate_line d ok "no protected path touched"
  fi

  # e) tests not weakened. A revert is exempt from the deletion and count
  #    checks — undoing a change removes the tests it added — and is held
  #    instead to restoring the pre-merge files exactly.
  if [ "$mode" = "plan" ]; then
    local tests_touched=""
    while IFS= read -r p; do
      [ -n "$p" ] && gate_is_test_file "$p" && tests_touched="$tests_touched $p"
    done <<EOF
$G_NAMES
EOF
    if [ -n "$tests_touched" ]; then
      _gate_line e FAIL "a planner branch touches tests:$tests_touched"
    else
      _gate_line e ok "no test file touched"
    fi
  elif [ "$mode" = "revert" ]; then
    if [ "${G_REVERT_EXACT:-0}" = "1" ]; then
      _gate_line e ok "the revert restores the pre-merge files exactly"
    else
      _gate_line e FAIL "the revert does not restore the pre-merge files exactly"
    fi
  else
    local deleted markers
    deleted="$(printf '%s\n' "$G_NAME_STATUS" | while IFS="$(printf '\t')" read -r st path; do
      [ "$st" = "D" ] && gate_is_test_file "$path" && printf '%s ' "$path"
    done || true)"
    markers="$(printf '%s\n' "$G_TEST_ADDED" | grep -E '\.(only|skip|fixme)[[:space:]]*\(' | head -3 || true)"
    if [ -n "$deleted" ]; then
      _gate_line e FAIL "test files deleted: $deleted"
    elif [ -n "$markers" ]; then
      _gate_line e FAIL "a .only, .skip or .fixme was added: $(printf '%s' "$markers" | head -1 | sed 's/^[[:space:]]*//')"
    elif ! [[ "${G_PASSED_HEAD:-}" =~ ^[0-9]+$ && "${G_PASSED_BASE:-}" =~ ^[0-9]+$ ]] || [ "${G_PASSED_BASE:-0}" -eq 0 ]; then
      if [ "${G_VERIFY_OK:-0}" = "skip" ]; then
        _gate_line e skip "no deletions or markers; test counts not measured in a dry run"
      else
        _gate_line e FAIL "passing-test count unknown (branch ${G_PASSED_HEAD:-?}, main ${G_PASSED_BASE:-?})"
      fi
    elif [ "$G_PASSED_HEAD" -lt "$G_PASSED_BASE" ]; then
      _gate_line e FAIL "fewer tests pass than on main ($G_PASSED_HEAD < $G_PASSED_BASE)"
    else
      _gate_line e ok "no test deleted or skipped; $G_PASSED_HEAD pass (main: $G_PASSED_BASE)"
    fi
  fi

  # f) size, excluding TASKS.md
  local total=0 a d f
  while IFS="$(printf '\t')" read -r a d f; do
    [ -n "$f" ] || continue
    [ "$f" = "TASKS.md" ] && continue
    if [ "$a" = "-" ] || [ "$d" = "-" ]; then
      total=$((total + GATE_MAX_LINES))
    else
      total=$((total + a + d))
    fi
  done <<EOF
$G_NUMSTAT
EOF
  if [ "$total" -ge "$GATE_MAX_LINES" ]; then
    _gate_line f FAIL "$total changed lines, excluding TASKS.md (limit: under $GATE_MAX_LINES)"
  else
    _gate_line f ok "$total changed lines, excluding TASKS.md"
  fi

  # g) kill switch
  if [ -e "$KILL_SWITCH" ]; then
    _gate_line g FAIL "kill switch is on: $KILL_SWITCH exists"
  else
    _gate_line g ok "kill switch is off"
  fi

  # h) one merge at a time. Before a merge the runner writes a marker; only a
  #    passing production check removes it. While it exists, nothing else
  #    merges — the one exception is the revert of that very merge. This
  #    replaced "one merge a night" on 30 September 2026: a night may merge
  #    several times, but never two that production has not seen one by one.
  if [ "$mode" = "revert" ]; then
    _gate_line h ok "a revert undoes the merge in flight; it is not a second one"
  elif [ "${G_MERGE_IN_FLIGHT:-0}" = "1" ]; then
    _gate_line h FAIL "an earlier merge has not passed its production check yet"
  else
    _gate_line h ok "no earlier merge is waiting for its production check"
  fi

  # i) time to watch it. A merge is followed by up to 15 minutes of waiting
  #    for production; a night that cannot give it that does not merge.
  case "${G_TIME_OK:-0}" in
    skip) _gate_line i skip "time left (not measured in a dry run)" ;;
    1)    _gate_line i ok "enough of the night left to watch the deploy" ;;
    *)    _gate_line i FAIL "under 15 minutes before the night's hard stop — no time to watch the deploy" ;;
  esac

  return "$verdict"
}

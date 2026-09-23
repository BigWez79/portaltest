#!/bin/bash
#
# Does the runner close the right draft?
#
# `overnight.sh:supersede_drafts` closes an open draft pull request once a later
# run has finished the task it attempted. Getting that wrong in one direction
# leaves the queue filling with drafts nobody reads; getting it wrong in the
# other closes somebody's work.
#
# The functions come from deploy/task-headings.sh — the same file the runner
# sources — rather than being copied here. A check that reimplements what it
# checks keeps passing after the original changes, which rule 12 says is not a
# check. What is exercised is the heading arithmetic; the gh and git calls
# around it are not, and that is written down rather than implied.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=deploy/task-headings.sh
. "$HERE/deploy/task-headings.sh"

MAIN=$'### 1. Alpha\n### 2. Beta\n### 3. Gamma'

# This run finished Beta: its TASKS.md no longer carries that heading.
MINE=$'### 1. Alpha\n### 2. Gamma'

main_h="$(printf '%s\n' "$MAIN" | task_titles)"
mine="$(headings_only_in_first "$main_h" "$(printf '%s\n' "$MINE" | task_titles)")"

failed=0
check() {
  local name="$1" draft="$2" want="$3" pr_h overlap got
  pr_h="$(printf '%s\n' "$draft" | task_titles)"
  overlap="$(headings_in_both "$(headings_only_in_first "$main_h" "$pr_h")" "$mine")"
  got="left open"
  [ -n "$overlap" ] && got="closed"
  if [ "$got" = "$want" ]; then
    printf '  ok    %-38s %s\n' "$name" "$got"
  else
    printf '  FAIL  %-38s wanted %s, got %s\n' "$name" "$want" "$got"
    failed=1
  fi
}

printf 'Superseding drafts: this run claims %s\n' "$(printf '%s' "$mine" | tr '\n' ' ')"

# The one it exists for: an earlier run attempted Beta, verify failed, the draft
# was left open, and this run has now finished it.
check "a draft that attempted this task" $'### 1. Alpha\n### 2. Gamma' "closed"

# The one that must not be touched.
check "a draft on a different task" $'### 1. Alpha\n### 2. Beta' "left open"

# A draft that never moved a heading claims nothing, so it matches nothing.
check "a draft that claimed nothing" "$MAIN" "left open"

# Two tasks in one run still matches a draft that did either of them.
mine="$(headings_only_in_first "$main_h" "$(printf '%s\n' '### 1. Alpha' | task_titles)")"
check "a run that finished two tasks" $'### 1. Alpha\n### 2. Beta' "closed"

if [ "$failed" -ne 0 ]; then
  printf '\nsupersede_drafts would close the wrong drafts.\n'
  exit 1
fi

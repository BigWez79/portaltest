# Reading TASKS.md, for the runner and for the check that the runner is right.
#
# Sourced rather than copied. A check that reimplements the logic it is checking
# passes just as happily after somebody changes the original, which rule 12 says
# is not a check — so both `overnight.sh` and `scripts/check-supersede.sh` get
# these from here.
#
# No side effects, nothing read from the environment: this file may be sourced
# by anything.

# "### 2. Rename the product" -> "Rename the product"
#
# Titles only, because the agent renumbers what is left behind when it moves a
# task to Done — "### 2. Rename..." becomes "### 1. Rename..." on the branch,
# and comparing whole headings reports every task as claimed.
task_titles() {
  grep '^### ' | sed 's/^### *//; s/^[0-9][0-9]*\. *//'
}

# The titles in the first list that are missing from the second.
#
# Run as (main, branch) this is "what that branch claims to have done": a branch
# that finished a task has moved its heading to Done, so the heading is gone
# from Next up. Nothing has to be recorded anywhere for that to work — the
# branches already say it.
headings_only_in_first() {
  local first="$1" second="$2" h
  printf '%s\n' "$first" | while IFS= read -r h; do
    [ -n "$h" ] || continue
    printf '%s\n' "$second" | grep -qxF "$h" || printf '%s\n' "$h"
  done
}

# The titles present in both lists.
headings_in_both() {
  local first="$1" second="$2" h
  printf '%s\n' "$first" | while IFS= read -r h; do
    [ -n "$h" ] || continue
    printf '%s\n' "$second" | grep -qxF "$h" && printf '%s\n' "$h"
  done
}

# --------------------------------------------------------------------------
# Task IDs. A task under "Next up" is headed `### T-12 — Title`. The ID is
# stable where the title and the number are not: the agent renumbers, people
# retitle, and an ID is what the runner, the stall guard and the merge gate
# all agree on.
# --------------------------------------------------------------------------

# The IDs of the tasks under any "## Next up" heading, in reading order.
next_up_ids() {
  awk '/^## /{inn = ($0 ~ /^## Next up/)} inn && /^### T-[0-9]+/ {
    match($0, /T-[0-9]+/); print substr($0, RSTART, RLENGTH)
  }'
}

# Headings under "Next up" that carry no ID. They are never picked; the runner
# says so, rather than letting a queue look empty when it is not.
next_up_unnumbered() {
  awk '/^## /{inn = ($0 ~ /^## Next up/)} inn && /^### / && !/^### T-[0-9]+/'
}

# Every T-n that appears anywhere under "## Done".
done_ids() {
  awk '/^## /{ind = ($0 ~ /^## Done/)} ind {
    s = $0
    while (match(s, /(^|[^A-Za-z0-9])T-[0-9]+/)) {
      t = substr(s, RSTART, RLENGTH); sub(/^[^T]/, "", t); print t
      s = substr(s, RSTART + RLENGTH)
    }
  }' | sort -u
}

# The full heading line for one ID, from TASKS.md on stdin.
heading_for_id() {
  grep -m1 -E "^### $1([^0-9]|\$)" | sed 's/^### *//'
}

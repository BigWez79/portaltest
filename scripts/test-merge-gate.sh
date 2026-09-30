#!/bin/bash
#
# Does the merge gate refuse what it must, and let through what it should?
#
# It sources the real deploy/merge-gate.sh and deploy/task-headings.sh, and
# takes PROTECTED_PATHS out of overnight.sh itself, from between its BEGIN and
# END markers — so editing the list, or the functions, is what gets tested, not
# a copy of them (CLAUDE.md rule 12).
#
# Each case is a real branch in a throwaway git repository, read by the real
# gate_collect. What is NOT exercised: the gh calls (draft, checks, merge,
# comment), the Vercel wait and the smoke test. Those inputs are set here to
# "passing" so that each case isolates one condition.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=deploy/task-headings.sh
. "$HERE/deploy/task-headings.sh"
# shellcheck source=deploy/merge-gate.sh
. "$HERE/deploy/merge-gate.sh"
# shellcheck source=deploy/night-loop.sh
. "$HERE/deploy/night-loop.sh"

LIST="$(sed -n '/^# BEGIN PROTECTED_PATHS/,/^# END PROTECTED_PATHS/p' "$HERE/overnight.sh")"
[ -n "$LIST" ] || { echo "no PROTECTED_PATHS block in overnight.sh"; exit 1; }
eval "$LIST"
[ "${#PROTECTED_PATHS[@]}" -gt 0 ] || { echo "PROTECTED_PATHS is empty"; exit 1; }

# A template with X's: GNU mktemp (CI) refuses `-t name` without them, and a
# failed mktemp must never leave this script running git in the real checkout.
# On 27 September it did exactly that on the CI runner — `cd ""` is a no-op,
# and the cases ran `git init`, commits and checkouts in the repository itself.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/merge-gate.XXXXXX")" || { echo "mktemp failed"; exit 1; }
[ -n "$WORK" ] && [ -d "$WORK" ] || { echo "no scratch directory"; exit 1; }
trap 'rm -rf "$WORK"' EXIT
KILL_SWITCH="$WORK/automerge-off"
cd "$WORK" || exit 1
if [ "$(pwd -P)" = "$(cd "$HERE" && pwd -P)" ] || git -C "$WORK" rev-parse --git-dir >/dev/null 2>&1; then
  echo "refusing: $WORK is inside a git repository, and this test runs git init, commit and checkout"
  exit 1
fi

git init -q -b main .
git config user.email gate-test@example.invalid
git config user.name "gate test"
git config commit.gpgsign false

mkdir -p tests src/lib src/app/auth/callback supabase/migrations
cat >TASKS.md <<'EOF'
# Queue

## Next up — new work

### T-7 — Something small

Do the small thing.

### T-8 — Something else

## Done

- **T-1 — Old work** — `overnight/auto-x`
EOF
printf 'import { test } from "@playwright/test";\ntest("a", () => {});\n' >tests/a.spec.ts
printf 'export const x = 1;\n' >src/lib/thing.ts
printf 'export const cb = 1;\n' >src/app/auth/callback/route.ts
printf '#!/bin/bash\n' >overnight.sh
git add -A && git commit -qm base

# The shape of a finished task: T-7 out of Next up and into Done.
finish_task() {
  cat >TASKS.md <<'EOF'
# Queue

## Next up — new work

### T-8 — Something else

## Done

- **T-7 — Something small** — `overnight/auto-test`
- **T-1 — Old work** — `overnight/auto-x`
EOF
}

failed=0
case_() {  # case_ NAME WANT(merge|refuse) LETTER-THAT-MUST-FAIL SETUP...
  local name="$1" want="$2" letter="$3"; shift 3
  git checkout -q main
  git checkout -q -b "case-$RANDOM$RANDOM"
  rm -f "$KILL_SWITCH"
  finish_task
  "$@"
  git add -A && git commit -qm "$name" --allow-empty

  G_VERIFY_OK=1 G_IS_DRAFT=0 G_CHECKS_OK=1 G_TASK_ID=T-7
  G_PASSED_HEAD=10 G_PASSED_BASE=10 G_MERGE_IN_FLIGHT="${CASE_IN_FLIGHT:-0}" G_TIME_OK="${CASE_TIME_OK:-1}"
  gate_collect main HEAD
  local out rc got
  out="$(gate_evaluate task)"; rc=$?
  got="refuse"; [ "$rc" -eq 0 ] && got="merge"
  if [ "$got" != "$want" ]; then
    printf '  FAIL  %-34s wanted %s, got %s\n%s\n' "$name" "$want" "$got" "$out"
    failed=1
  elif [ "$want" = "refuse" ] && ! printf '%s\n' "$out" | grep -qE "^  FAIL $letter "; then
    printf '  FAIL  %-34s refused, but not by condition %s\n%s\n' "$name" "$letter" "$out"
    failed=1
  else
    printf '  ok    %-34s %s\n' "$name" "$got"
  fi
}

noop() { :; }
add_code() { printf 'export const y = 2;\n' >src/lib/other.ts; printf 'import { test } from "@playwright/test";\ntest("b", () => {});\n' >tests/b.spec.ts; }
add_migration() { printf 'create table t ();\n' >supabase/migrations/0099_t.sql; }
touch_auth() { printf 'export const cb = 2;\n' >src/app/auth/callback/route.ts; }
touch_runner() { printf '#!/bin/bash\necho changed\n' >overnight.sh; }
delete_test() { git rm -q tests/a.spec.ts; }
add_only() { printf 'import { test } from "@playwright/test";\ntest.only("a", () => {});\n' >tests/a.spec.ts; }
add_900() { seq 1 900 | sed 's/^/export const v/; s/$/ = 0;/' >src/lib/big.ts; }
kill_switch() { add_code; touch "$KILL_SWITCH"; }
touch_roadmap() { add_code; mkdir -p docs; printf '## Ready to build\n\n### R-9 — Something the machine wants\n' >>docs/ROADMAP.md; }

printf 'Merge gate, against real diffs:\n'
# Rule 12, one line each — what would have to be true for the case to pass wrongly:
#   clean diff: every condition would have to be too strict, which this case exists to catch.
case_ "a clean one-task change"          merge  -  add_code
#   migration: the glob would have to miss supabase/migrations/*, or the diff would have to omit an added file.
case_ "a migration"                      refuse d add_migration
#   auth: src/app/auth/* would have to be missing from PROTECTED_PATHS.
case_ "a sign-in file"                   refuse d touch_auth
#   runner: overnight.sh would have to be missing from the list — or edited out of the list in this same file, which is itself protected.
case_ "overnight.sh"                     refuse d touch_runner
#   deleted test: the D status would have to be lost — which --no-renames exists to prevent for a moved file.
case_ "a deleted test"                   refuse e delete_test
#   .only: the marker would have to be spelled another way (test["only"]), which this regex does not see.
case_ "an added .only"                   refuse e add_only
#   900 lines: numstat would have to under-count; a binary file counts as the whole limit for that reason.
case_ "900 lines changed"                refuse f add_900
#   kill switch: KILL_SWITCH would have to point somewhere other than the file a person creates.
case_ "the kill switch present"          refuse g kill_switch
#   ROADMAP.md: docs/ROADMAP.md would have to be missing from PROTECTED_PATHS in overnight.sh — the list read here is that list.
case_ "a change to docs/ROADMAP.md"      refuse d touch_roadmap

# Two the brief did not list, because they are how the gate would be walked past:
#   no task moved: a branch that did work but never moved its task to Done.
case_ "no task moved to Done"            refuse c eval 'add_code; git checkout -q main -- TASKS.md'
#   one at a time: G_MERGE_IN_FLIGHT would have to be 0 while the marker exists — overnight.sh sets it from
#   the marker file, and test-night-loop.sh checks the loop will not start a task while it exists.
CASE_IN_FLIGHT=1
case_ "a merge while one is unconfirmed" refuse h add_code
CASE_IN_FLIGHT=0
#   the clock: G_TIME_OK would have to default to "1" when unset — it defaults to 0, so a caller that forgets refuses.
CASE_TIME_OK=0
case_ "too close to the hard stop"       refuse i add_code
CASE_TIME_OK=1

# A revert: it deletes the test its merge added and moves the task back, and
# must still pass — but only in revert mode, and only if it is exact.
rm -f "$KILL_SWITCH"
git checkout -q main
git checkout -q -b revert-base
finish_task; add_code; git add -A; git commit -qm "the change"
MERGED="$(git rev-parse HEAD)"
git checkout -q -b revert-case
git revert --no-edit "$MERGED" >/dev/null
G_VERIFY_OK=1 G_IS_DRAFT=0 G_CHECKS_OK=1 G_MERGE_IN_FLIGHT=1 G_TIME_OK=1
G_REVERT_PATHS="$(git diff-tree --no-commit-id --name-only -r --no-renames "$MERGED")"
G_REVERT_EXACT=0
git diff --quiet "$MERGED^" HEAD -- $G_REVERT_PATHS && G_REVERT_EXACT=1
gate_collect revert-base HEAD
if out="$(gate_evaluate revert)"; then
  printf '  ok    %-34s merge\n' "an exact revert"
else
  printf '  FAIL  %-34s wanted merge\n%s\n' "an exact revert" "$out"; failed=1
fi

# --------------------------------------------------------------------------
# The planner, in plan mode. Its branch may add tasks to TASKS.md, each with a
# Source: line naming an item under "Ready to build" in docs/ROADMAP.md — or a
# pull request that failed tonight — and nothing else.
# --------------------------------------------------------------------------
printf '\nThe planner (plan mode), against real diffs:\n'
rm -f "$KILL_SWITCH"
git checkout -q main
mkdir -p docs
cat >docs/ROADMAP.md <<'EOF'
# Roadmap

## Ready to build

### R-1 — Tidy the widget

Make the widget tidy.

### R-2 — Another ready thing

## Needs Wesley first

### W-1 — A decision only Wesley can take
EOF
git add -A && git commit -qm roadmap
ROADMAP_TEXT="$(cat docs/ROADMAP.md)"

# plan_task ID SOURCE-LINE [extra lines...] — append a task to Next up — new work,
# the way the planner is told to: at the end of the section, adding lines only.
# With one line after the ID, that is the Source: line and the rest of a
# well-formed task follows it; with more, those lines are the whole task body.
plan_task() {
  local id="$1" lines body; shift
  if [ "$#" -eq 1 ]; then
    lines="$(printf '%s\nSize: S — small\n\n- [ ] it works\n\n**Done when** it works.' "$1")"
  else
    lines="$(printf '%s\n' "$@")"
  fi
  body="$(printf '### %s — Planned thing\n\n%s\n' "$id" "$lines")"
  BODY="$body" awk '
    /^## / && innew { print ENVIRON["BODY"]; print ""; innew = 0 }
    /^## Next up — new work/ { innew = 1 }
    { print }' TASKS.md >TASKS.md.new && mv TASKS.md.new TASKS.md
}

# plan_case NAME WANT SETUP... — WANT is "merge", or the text the refusal must
# contain. Refused for some other reason is a failure: a case that passes
# because the plan was broken in a way it did not mean to test is not a case.
plan_case() {
  local name="$1" want="$2"; shift 2
  G_ROADMAP_USED="$(roadmap_used_history main)"
  git checkout -q main
  git checkout -q -b "plan-$RANDOM$RANDOM"
  "$@"
  git add -A && git commit -qm "$name" --allow-empty
  G_IS_DRAFT=0 G_CHECKS_OK=1 G_MERGE_IN_FLIGHT=0 G_TIME_OK=1
  G_ROADMAP="${CASE_ROADMAP-$ROADMAP_TEXT}" G_FIX_REFS="${CASE_FIX_REFS:-}"
  gate_collect main HEAD
  local out rc got
  out="$(gate_evaluate plan)"; rc=$?
  got="refuse"; [ "$rc" -eq 0 ] && got="merge"
  if [ "$want" = "merge" ] && [ "$got" != "merge" ]; then
    printf '  FAIL  %-40s wanted merge, got refuse\n%s\n' "$name" "$out"
    failed=1
  elif [ "$want" != "merge" ] && { [ "$got" = "merge" ] || ! printf '%s\n' "$out" | grep -F -- "$want" | grep -qE '^  FAIL [cd] '; }; then
    printf '  FAIL  %-40s wanted a refusal saying "%s", got %s\n%s\n' "$name" "$want" "$got" "$out"
    failed=1
  else
    printf '  ok    %-40s %s\n' "$name" "$got"
  fi
}

# Rule 12, one line each — what would have to be true for the case to pass wrongly:
#   a valid plan: planner_check would have to be too strict; this is the case that says it is not.
plan_case "a roadmap item, properly sourced"         merge  plan_task T-9 "Source: ROADMAP — R-1 — Tidy the widget"
#   no source: the Source: grep would have to match a line in another task's block — task_block stops at the next ###.
plan_case "a task with no ROADMAP source"            "T-9 has no Source: line" plan_task T-9 "Size: S" "**Done when** it works."
#   invented: roadmap_ready_ids would have to read past "## Needs Wesley first" — it stops at the next ## heading.
plan_case "a source that is not on the roadmap"      "names R-7, which is not under" plan_task T-9 "Source: ROADMAP — R-7 — Invented"
plan_case "a Needs-Wesley-first item"                "source is neither" plan_task T-9 "Source: ROADMAP — W-1 — A decision only Wesley can take"
#   draft: roadmap_is_draft would have to miss "Status: DRAFT" — the exact line the draft carries.
CASE_ROADMAP="$(printf 'Status: DRAFT\n\n%s\n' "$ROADMAP_TEXT")"
plan_case "a roadmap still marked DRAFT"             "still marked DRAFT" plan_task T-9 "Source: ROADMAP — R-1 — Tidy the widget"
unset CASE_ROADMAP
#   rewrites: G_TASKS_DELETED would have to miss a changed line — git diff shows every change as a - and a +.
plan_case "a planner that rewrites an existing task" "the planner only adds" eval 'plan_task T-9 "Source: ROADMAP — R-1 — Tidy the widget"; sed -i.bak "s/Do the small thing./Do a bigger thing./" TASKS.md; rm -f TASKS.md.bak'
#   a Done entry deleted: a count that grepped the patch for "^-[^-]" missed exactly this line, which is "-- **T-1…".
plan_case "a planner that deletes a Done entry"      "the planner only adds" eval 'plan_task T-9 "Source: ROADMAP — R-1 — Tidy the widget"; grep -v "T-1 — Old work" TASKS.md >t && mv t TASKS.md'
#   other files: G_NAMES would have to omit a changed file.
plan_case "a planner that writes code too"           "changes only TASKS.md" eval 'plan_task T-9 "Source: ROADMAP — R-1 — Tidy the widget"; add_code'
#   reuse: an ID already in Done would have to be treated as new — it is found anywhere in the base file.
plan_case "a reused ID"                              "T-1 is already used" plan_task T-1 "Source: ROADMAP — R-1 — Tidy the widget"
#   a fix: G_FIX_REFS would have to contain a PR that did not fail — overnight.sh fills it only from failed tasks.
CASE_FIX_REFS="61"
plan_case "a fix for a PR that failed tonight"       merge  plan_task T-9 "Source: FIX — #61"
plan_case "a fix for a PR that did not fail"         "#62, which did not fail tonight" plan_task T-9 "Source: FIX — #62"
CASE_FIX_REFS=""
#   no Done when: the grep would have to find "Done when" outside the task's own block.
plan_case "a task with no Done when"                 "no \"Done when\" line" plan_task T-9 "Source: ROADMAP — R-1 — Tidy the widget" "Size: S"
#   the planner touching ROADMAP.md itself: protected, and not TASKS.md.
plan_case "a planner that edits the roadmap"         "touches protected paths: docs/ROADMAP.md" eval 'plan_task T-9 "Source: ROADMAP — R-1 — Tidy the widget"; printf "### R-3 — More\n" >>docs/ROADMAP.md'

# An item queued before and since finished: its task is a one-line Done entry
# now, and its Source: line is gone from TASKS.md — but not from the history.
#   queued twice: roadmap_used_history would have to read TASKS.md as it is rather than main's log.
git checkout -q main
plan_task T-9 "Source: ROADMAP — R-1 — Tidy the widget"
git commit -qam "plan: queue T-9"
awk '/^### T-9/{skip=1} /^## /{skip=0} !skip{print} /^## Done/{print ""; print "- **T-9 — Planned thing** — `b`"}' TASKS.md >t && mv t TASKS.md
git commit -qam "T-9 done"
check_unplanned="$(roadmap_unplanned "$ROADMAP_TEXT" "$(cat TASKS.md)" "$(roadmap_used_history main)" | paste -sd ' ' -)"
if [ "$check_unplanned" = "R-2" ]; then
  printf '  ok    %-40s %s\n' "a finished item is not unplanned again" "R-2 left"
else
  printf '  FAIL  %-40s wanted "R-2", got "%s"\n' "a finished item is not unplanned again" "$check_unplanned"; failed=1
fi
plan_case "queueing a finished item again"           "names R-1, which already has a task" plan_task T-10 "Source: ROADMAP — R-1 — Tidy the widget"

if [ "$failed" -ne 0 ]; then
  printf '\nThe merge gate would decide wrongly.\n'
  exit 1
fi

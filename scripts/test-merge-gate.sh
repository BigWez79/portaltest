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

LIST="$(sed -n '/^# BEGIN PROTECTED_PATHS/,/^# END PROTECTED_PATHS/p' "$HERE/overnight.sh")"
[ -n "$LIST" ] || { echo "no PROTECTED_PATHS block in overnight.sh"; exit 1; }
eval "$LIST"
[ "${#PROTECTED_PATHS[@]}" -gt 0 ] || { echo "PROTECTED_PATHS is empty"; exit 1; }

WORK="$(mktemp -d -t merge-gate)"
trap 'rm -rf "$WORK"' EXIT
KILL_SWITCH="$WORK/automerge-off"
cd "$WORK" || exit 1

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
  G_PASSED_HEAD=10 G_PASSED_BASE=10 G_MERGED_TODAY="${CASE_MERGED_TODAY:-0}"
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

# Two the brief did not list, because they are how the gate would be walked past:
#   no task moved: a branch that did work but never moved its task to Done.
case_ "no task moved to Done"            refuse c eval 'add_code; git checkout -q main -- TASKS.md'
#   a second merge in one night.
CASE_MERGED_TODAY=1
case_ "a second merge tonight"           refuse h add_code
CASE_MERGED_TODAY=0

# A revert: it deletes the test its merge added and moves the task back, and
# must still pass — but only in revert mode, and only if it is exact.
rm -f "$KILL_SWITCH"
git checkout -q main
git checkout -q -b revert-base
finish_task; add_code; git add -A; git commit -qm "the change"
MERGED="$(git rev-parse HEAD)"
git checkout -q -b revert-case
git revert --no-edit "$MERGED" >/dev/null
G_VERIFY_OK=1 G_IS_DRAFT=0 G_CHECKS_OK=1 G_MERGED_TODAY=1
G_REVERT_PATHS="$(git diff-tree --no-commit-id --name-only -r --no-renames "$MERGED")"
G_REVERT_EXACT=0
git diff --quiet "$MERGED^" HEAD -- $G_REVERT_PATHS && G_REVERT_EXACT=1
gate_collect revert-base HEAD
if out="$(gate_evaluate revert)"; then
  printf '  ok    %-34s merge\n' "an exact revert"
else
  printf '  FAIL  %-34s wanted merge\n%s\n' "an exact revert" "$out"; failed=1
fi

if [ "$failed" -ne 0 ]; then
  printf '\nThe merge gate would decide wrongly.\n'
  exit 1
fi

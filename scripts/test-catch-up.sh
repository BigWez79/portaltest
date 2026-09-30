#!/bin/bash
#
# Does the catch-up run a night once, and never twice in a day?
#
# The overnight job fires at 03:00, at 12:30 and at load (a login after a
# restart). This runs the real overnight.sh — not a copy of its logic — against
# a throwaway repository with pretend gh, claude, npm and node on PATH, and
# watches what each fire does. The queue and the roadmap are both empty, so a
# night that runs goes straight to "roadmap exhausted" and its report, which
# is enough to tell a run from an exit-at-once.
#
# What is NOT exercised: launchd itself. That the plist fires at 03:00, 12:30
# and at load is read from the plist by the last case, not observed.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/catch-up.XXXXXX")" || { echo "mktemp failed"; exit 1; }
[ -n "$WORK" ] && [ -d "$WORK" ] || { echo "no scratch directory"; exit 1; }
trap 'rm -rf "$WORK"' EXIT

TODAY="$(date '+%Y-%m-%d')"
YESTERDAY="1999-12-31"

# --- a repository with an origin, main, an empty queue and an empty roadmap ---
git init -q --bare -b main "$WORK/origin.git" 2>/dev/null || { git init -q --bare "$WORK/origin.git" && git -C "$WORK/origin.git" symbolic-ref HEAD refs/heads/main; }
REPO="$WORK/portal"
git clone -q "$WORK/origin.git" "$REPO" 2>/dev/null
cd "$REPO" || exit 1
git checkout -q -b main 2>/dev/null || true
git config user.email catch-up@example.invalid
git config user.name "catch-up test"
git config commit.gpgsign false
mkdir -p docs
printf '# Queue\n\n## Next up — new work\n\n## Held — needs a person\n\n## Done\n' >TASKS.md
printf '# Rules\n' >CLAUDE.md
printf '# Roadmap\n\n## Ready to build\n\n## Needs Wesley first\n\n### W-1 — Something only Wesley can decide\n' >docs/ROADMAP.md
git add -A && git commit -qm base && git push -q origin main 2>/dev/null
cd "$WORK" || exit 1

# --- pretend commands. gh records every call; that is how a run is told apart
# from an exit-at-once. ---
BIN="$WORK/bin"
mkdir -p "$BIN"
cat >"$BIN/gh" <<EOF
#!/bin/bash
printf '%s\n' "\$*" >>"$WORK/gh-calls"
case "\$1 \$2" in
  "issue create") echo "https://github.com/example/portal/issues/1" ;;
esac
exit 0
EOF
cat >"$BIN/claude" <<'EOF'
#!/bin/bash
# The dry run's probe: write a file and commit it, as a working agent would.
echo ok >.dry-run-probe && git add .dry-run-probe && git commit -qm "dry run probe"
EOF
printf '#!/bin/bash\nexit 0\n' >"$BIN/npm"
printf '#!/bin/bash\nexit 0\n' >"$BIN/node"
chmod +x "$BIN"/*

STATE="$WORK/state"
LOGS="$WORK/logs"
fire() {  # fire [ARGS] — one launchd fire, as the plist would make it. Sets RC and OUT.
  OUT="$(HOME="$WORK/home" PATH="$BIN:$PATH" \
    PORTAL_REPO="$REPO" PORTAL_STATE_DIR="$STATE" PORTAL_LOG_DIR="$LOGS" \
    PORTAL_LOCK_DIR="$WORK/lock" AUTOMERGE_KILL_SWITCH="$WORK/automerge-off" \
    PORTAL_GH_REPO="example/portal" \
    bash "$HERE/overnight.sh" "$@" 2>&1)"
  RC=$?
}
gh_calls() { wc -l <"$WORK/gh-calls" 2>/dev/null | tr -d ' ' || echo 0; }
stamp() { cat "$STATE/last-start" 2>/dev/null || echo none; }

failed=0
check() {  # check NAME WANT GOT
  if [ "$2" = "$3" ]; then
    printf '  ok    %-52s %s\n' "$1" "$3"
  else
    printf '  FAIL  %-52s wanted "%s", got "%s"\n' "$1" "$2" "$3"
    printf '%s\n' "$OUT" | tail -15 | sed 's/^/        /'
    failed=1
  fi
}

printf 'The catch-up:\n'
mkdir -p "$WORK/home"

# Rule 12, one line each — what would have to be true for the case to pass wrongly.

#   the first fire of a day: it would have to exit before the loop and still write the report —
#   the report is written only after the loop, so a report means the night ran.
fire
check "first fire of the day runs the night"               "0" "$RC"
check "  and marks today as started"                       "$TODAY" "$(stamp)"
check "  and writes the report"                            "yes" "$(grep -q 'roadmap exhausted — needs Wesley' "$LOGS/nightly-report.md" 2>/dev/null && echo yes || echo no)"
check "  and posts it to the pinned issue"                 "yes" "$(grep -q '^issue comment' "$WORK/gh-calls" && echo yes || echo no)"
check "  and its NEEDS WESLEY names the roadmap"           "yes" "$(grep -q 'Ready to build' "$LOGS/nightly-report.md" 2>/dev/null && echo yes || echo no)"

#   twice in a day: already_started_today would have to compare something other than today's date,
#   or be asked after gh — gh's call log would then grow.
before="$(gh_calls)"
fire
check "second fire the same day exits 0"                   "0" "$RC"
check "  and does nothing: no gh call at all"              "$before" "$(gh_calls)"
check "  and says why"                                     "yes" "$(printf '%s' "$OUT" | grep -q 'already started today' && echo yes || echo no)"
fire
check "a third fire (12:30, or a login) — still nothing"   "$before" "$(gh_calls)"

#   dirty: the stamp would have to be written before the dirty check — then this would read today.
printf '%s\n' "$YESTERDAY" >"$STATE/last-start"
touch "$REPO/somebody-elses-work.txt"
fire
check "a new day on a dirty tree exits 64 as usual"        "64" "$RC"
check "  and does not mark the day started"                "$YESTERDAY" "$(stamp)"
fire
check "  so the next fire tries again, and exits 64 again" "64" "$RC"

#   dirty but already run: this would read 64 if the dirty check came before the once-a-day check.
printf '%s\n' "$TODAY" >"$STATE/last-start"
fire
check "already ran today, now dirty: exits 0 at once"      "0" "$RC"
rm -f "$REPO/somebody-elses-work.txt"

#   two fires at once: the second would have to skip the lock. A live PID (this shell) holds it.
printf '%s\n' "$YESTERDAY" >"$STATE/last-start"
mkdir -p "$WORK/lock" && printf '%s' "$$" >"$WORK/lock/pid"
before="$(gh_calls)"
fire
check "a fire while another run holds the lock exits 66"   "66" "$RC"
check "  and does not mark the day started"                "$YESTERDAY" "$(stamp)"
check "  and does nothing"                                 "$before" "$(gh_calls)"
rm -rf "$WORK/lock"

#   the dry run: it would have to read the stamp (and stop), or write it (and block tonight).
printf '%s\n' "$TODAY" >"$STATE/last-start"
fire --dry-run
check "a dry run is not stopped by today's stamp"          "0" "$RC"
check "  prints WOULD BUILD"                               "yes" "$(printf '%s' "$OUT" | grep -q 'WOULD BUILD: nothing' && echo yes || echo no)"
check "  prints WOULD STOP BECAUSE"                        "yes" "$(printf '%s' "$OUT" | grep -q 'WOULD STOP BECAUSE: roadmap exhausted' && echo yes || echo no)"
check "  leaves the repository on main, clean"             "main " "$(git -C "$REPO" rev-parse --abbrev-ref HEAD) $(git -C "$REPO" status --porcelain)"
printf '%s\n' "$YESTERDAY" >"$STATE/last-start"
fire --dry-run
check "  and does not write the stamp"                     "$YESTERDAY" "$(stamp)"

#   the plist: these would pass with a plist that did not fire at 12:30 or at load — so read it.
PLIST="$HERE/deploy/uk.poweranalytix.portal.overnight.plist"
check "the plist fires at 03:00 and 12:30"                 "3:0 12:30" "$(awk '/<key>Hour<\/key>/ { gsub(/[^0-9]/, ""); h = $0 } /<key>Minute<\/key>/ { gsub(/[^0-9]/, ""); printf "%s%s:%s", sep, h, $0; sep = " " }' "$PLIST")"
check "the plist runs at load"                             "yes" "$(awk '/<key>RunAtLoad<\/key>/ { getline; print ($0 ~ /<true\/>/) ? "yes" : "no" }' "$PLIST")"

if [ "$failed" -ne 0 ]; then
  printf '\nThe catch-up would run a night twice, or miss one.\n'
  exit 1
fi

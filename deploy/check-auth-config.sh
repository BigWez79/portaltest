#!/usr/bin/env bash
#
# check-auth-config.sh — assert the linked Supabase project's auth settings are
# what BLOCKED.md says they must be. Exits non-zero if they are not.
#
# WHY THIS IS NOT A TEST
#
# The Playwright suite reads staff from tests/fixtures/staff.json and
# playwright.config.ts hands it throwaway Supabase values, on purpose: the suite
# reaches no live service, so it runs the same at 03:00 on the Mac Studio as it
# does on a laptop on a train. That is worth keeping, and it means the suite is
# structurally incapable of noticing anything about a real project.
#
# It is exactly the gap this fills. On 2026-08-25, portal-staging was found with
# `disable_signup: false` — any address on earth could request a sign-in link
# and get an auth.users row — while `npm run verify` was green, had been green
# all along, and would have stayed green forever. src/app/actions/auth.ts even
# carried a comment asserting signups were off. Nothing checked.
#
# So: a separate script, run by a person or by the daily keep-alive job. Never
# wired into `npm run verify`, because verify must not need the network or a
# credential.
#
# WHAT IT CANNOT DO
#
# It reports; it does not fix. Changing these is a project setting and a person
# does it in the dashboard (BLOCKED.md). `supabase config push` would be the
# workaround that list forbids, and is deliberately not used here.
#
#   ./deploy/check-auth-config.sh
#
# Exit: 0 all good · 2 a setting is wrong · 78 cannot run the check at all

set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=deploy/env-lib.sh
. ./env-lib.sh

command -v python3 >/dev/null 2>&1 || { log "FATAL: python3 not on PATH"; exit 78; }

require_env_file
URL="$(require_env_var SUPABASE_URL)"
KEY="$(require_env_var SUPABASE_ANON_KEY)"

# GoTrue's own view of its live configuration. Public with an apikey, read-only,
# and better evidence than a dashboard screenshot: it is what the server is
# actually doing, not what someone remembers setting.
SETTINGS="$(curl -sS --max-time 20 -H "apikey: $KEY" "${URL%/}/auth/v1/settings" || true)"

[ -n "$SETTINGS" ] || { log "FATAL: no answer from ${URL%/}/auth/v1/settings"; exit 78; }

# Each row: json path, required value, and what goes wrong when it is not that.
# disable_signup is the one BLOCKED.md names; the other two are the same class
# of mistake — a setting that quietly turns the staff list into an open door.
# `|| rc=$?` because `set -e` would otherwise abort here on a failed check,
# before the script gets to say what to do about it.
rc=0
python3 - "$SETTINGS" <<'PY' || rc=$?
import json, sys

try:
    s = json.loads(sys.argv[1])
except json.JSONDecodeError:
    print("FATAL: /auth/v1/settings did not return JSON", file=sys.stderr)
    raise SystemExit(78)

CHECKS = [
    (("disable_signup",), True,
     "any address on earth can request a sign-in link and get an auth.users row "
     "(BLOCKED.md: email signups stay disabled)"),
    (("mailer_autoconfirm",), False,
     "a link would not need to be clicked — knowing an address would be enough to sign in"),
    (("external", "anonymous_users"), False,
     "anonymous sessions would bypass the staff list entirely"),
]

def get(d, path):
    for k in path:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d

failed = []
for path, want, consequence in CHECKS:
    name = ".".join(path)
    got = get(s, path)
    if got is None:
        failed.append(f"{name} is absent from /auth/v1/settings — cannot confirm it")
    elif got is not want:
        failed.append(f"{name} is {json.dumps(got)}, must be {json.dumps(want)} — {consequence}")
    else:
        print(f"  ok    {name} = {json.dumps(got)}")

for f in failed:
    print(f"  FAIL  {f}")

raise SystemExit(2 if failed else 0)
PY

if [ "$rc" -eq 0 ]; then
  log "auth config OK — ${URL%/}"
else
  log "auth config WRONG — fix it in the dashboard, a person does this (BLOCKED.md):"
  log "  Authentication -> Sign In / Providers -> Email -> Allow new users to sign up"
fi

exit "$rc"

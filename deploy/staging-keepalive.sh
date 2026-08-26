#!/usr/bin/env bash
#
# staging-keepalive.sh — one HTTP request, so portal-staging does not pause.
#
# Supabase pauses a free project after a stretch with no activity, and an
# unpausing is a manual click. The overnight run deliberately passes no Supabase
# variables (see uk.poweranalytix.portal.overnight.plist), so it will never be
# what keeps staging warm. Something has to, and this is it.
#
# It is a SEPARATE launchd job on purpose. This is the one piece of scheduled
# work that legitimately needs a Supabase credential; folding it into the
# overnight job would hand that credential back to the run whose entire
# guarantee is that it has none. Two jobs, two blast radii.
#
# What it does NOT do: read a table, write anything, or touch the service-role
# key. It asks GoTrue for its health, with the anon key, and that endpoint was
# chosen over the obvious alternatives for two measured reasons:
#
#   - PostgREST's root document (/rest/v1/) answers "Only the `service_role` API
#     key can be used for this endpoint" on this project. A keep-alive should
#     prove the project answers, not hold a key that can change anything.
#   - /rest/v1/staff 404s with PGRST205 until 0001_staff.sql is applied, and
#     will keep doing so for as long as that migration waits on a person. A
#     keep-alive that depends on schema state reports a paused project when the
#     project is fine.
#
# The key is read out of .env.local into a variable and passed to curl in a
# header. It is never echoed, never logged, and never put on a command line
# where `ps` could see it.

set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=deploy/env-lib.sh
. ./env-lib.sh

require_env_file
URL="$(require_env_var SUPABASE_URL)"
KEY="$(require_env_var SUPABASE_ANON_KEY)"

# --max-time so a hung connection cannot leave a launchd job running all day.
# -o /dev/null because the body is of no interest; only that it answered.
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
  -H "apikey: $KEY" \
  "${URL%/}/auth/v1/health" || echo "000")"

case "$CODE" in
  200)
    log "portal-staging awake (HTTP $CODE)"
    ;;
  000)
    log "FAILED: no answer from ${URL%/} within 20s — network, or the project is paused"
    exit 1
    ;;
  401|403)
    log "FAILED: HTTP $CODE — the anon key in $PORTAL_ENV_FILE is wrong or has been rotated"
    exit 1
    ;;
  *)
    log "FAILED: HTTP $CODE from ${URL%/}/auth/v1/health"
    exit 1
    ;;
esac

# --------------------------------------------------------------------------
# Staging being awake is not the same as staging being safe. The Playwright
# suite runs on fixtures and reaches no live project, so nothing in
# `npm run verify` will ever notice a project setting drifting — which is how
# portal-staging sat with signups enabled while the suite was green. This job
# already runs daily and already holds the anon key, so it is the natural place
# to notice. Its exit code is kept distinct from a failed ping: 1 means staging
# did not answer, 2 means it answered and is configured wrongly.
# --------------------------------------------------------------------------
./check-auth-config.sh || exit 2

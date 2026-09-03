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
# It reads a row. That is the change, and it is the whole point.
#
# This used to ask GoTrue for its health, which answered 200 every morning and
# counted for nothing. On 1 September Supabase warned that portal-staging had
# seen no sufficient activity for seven days — while this job was loaded, firing
# daily at 07:00, and exiting 0 every time. A green log and a project sliding
# toward a pause, for a week, with nothing to tell them apart.
#
# The health endpoint answers without touching the database, so it is not
# activity. A PostgREST select is. `staff?select=id&limit=1` returns an empty
# array under RLS with the anon key, which is the smallest real query there is:
# it reads no data and proves the database served a request.
#
# The reason this endpoint was rejected the first time — /rest/v1/staff 404s
# with PGRST205 until 0001_staff.sql is applied — expired when that migration
# was applied on 3 September. PostgREST's root document is still no good: it
# answers "Only the `service_role` API key can be used for this endpoint", and a
# keep-alive has no business holding a key that can change anything.
#
# It still writes nothing and still never touches the service-role key.
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
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "${URL%/}/rest/v1/staff?select=id&limit=1" || echo "000")"

case "$CODE" in
  200)  log "portal-staging awake (HTTP $CODE, real query)" ;;
  000)  log "FAILED: no answer from ${URL%/} within 20s — network, or the project is paused"; exit 1 ;;
  401|403) log "FAILED: HTTP $CODE — the anon key in $PORTAL_ENV_FILE is wrong or rotated"; exit 1 ;;
  404)  log "FAILED: HTTP 404 — staff is missing (PGRST205). A migration has not been applied."; exit 1 ;;
  *)    log "FAILED: HTTP $CODE from ${URL%/}/rest/v1/staff"; exit 1 ;;
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

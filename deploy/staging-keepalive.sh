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

ENV_FILE="${PORTAL_ENV_FILE:-/Users/wesleyhughes/portal/.env.local}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

read_var() {
  # First match wins, everything after the first "=" is the value.
  #
  # The surrounding quotes matter: `supabase projects api-keys -o env` writes
  # KEY="value", and a naive read sends those quotes to the server inside the
  # header, which comes back as a flat 401 "Invalid API key" that looks for all
  # the world like a rotated credential. Strip a matched pair of either kind.
  sed -n "s/^\(export \)\{0,1\}$1=//p" "$ENV_FILE" \
    | head -1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

[ -r "$ENV_FILE" ] || { log "FATAL: $ENV_FILE is not readable"; exit 78; }

URL="$(read_var SUPABASE_URL)"
KEY="$(read_var SUPABASE_ANON_KEY)"

[ -n "$URL" ] || { log "FATAL: SUPABASE_URL is empty in $ENV_FILE"; exit 78; }
[ -n "$KEY" ] || { log "FATAL: SUPABASE_ANON_KEY is empty in $ENV_FILE"; exit 78; }

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
    log "FAILED: HTTP $CODE — the anon key in $ENV_FILE is wrong or has been rotated"
    exit 1
    ;;
  *)
    log "FAILED: HTTP $CODE from ${URL%/}/auth/v1/health"
    exit 1
    ;;
esac

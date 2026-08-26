#!/usr/bin/env bash
#
# env-lib.sh — shared by the scripts in this directory. Not executable on its
# own; source it.
#
# It exists for one reason. `supabase projects api-keys -o env` writes values
# wrapped in quotes:
#
#     SUPABASE_ANON_KEY="eyJhbGciOi..."
#
# A naive read passes those quotes into the request header, and Supabase answers
# with a flat `401 Invalid API key` that reads exactly like a rotated
# credential. Next's dotenv strips them, so the app is fine and only hand-rolled
# readers are caught. That cost half an hour once; having two copies of the
# parser to fix next time is how it would cost it again.

PORTAL_ENV_FILE="${PORTAL_ENV_FILE:-/Users/wesleyhughes/portal/.env.local}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

require_env_file() {
  [ -r "$PORTAL_ENV_FILE" ] || { log "FATAL: $PORTAL_ENV_FILE is not readable"; exit 78; }
}

# read_env_var NAME — first match wins, surrounding quotes of either kind
# stripped, optional `export ` prefix tolerated.
read_env_var() {
  sed -n "s/^\(export \)\{0,1\}$1=//p" "$PORTAL_ENV_FILE" \
    | head -1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# require_env_var NAME — as above, but empty is fatal. Never echoes the value.
require_env_var() {
  local value
  value="$(read_env_var "$1")"
  [ -n "$value" ] || { log "FATAL: $1 is empty in $PORTAL_ENV_FILE"; exit 78; }
  printf '%s' "$value"
}

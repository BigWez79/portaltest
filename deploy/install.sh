#!/usr/bin/env bash
#
# install.sh — put the scheduled jobs somewhere they cannot be moved out from
# under.
#
# The plists used to run scripts straight out of the working tree. That works
# right up until the tree is on a branch without deploy/ in it, and then launchd
# fires on schedule and the shell says:
#
#   zsh:1: no such file or directory: /Users/wesleyhughes/portal/deploy/staging-keepalive.sh
#
# which is what happened at 07:00 on 2026-08-26. A scheduled job has no business
# caring which branch somebody left checked out at bedtime.
#
# So the scripts are installed, exactly as the plists themselves are installed:
# edit them here, run this, and the copy is what runs. The cost is that this has
# to be re-run after editing — which is the same discipline the plists already
# needed, and is cheap next to a job that silently stops working.
#
# Logs move out of the repo for the same reason from the other direction:
# agent_logs/ is only in .gitignore on the branch that introduced it, so a log
# written while another branch is checked out leaves an untracked file, and an
# untracked file aborts the next unattended run.
#
#   ./deploy/install.sh
#
# Installing does not start anything. Bootstrapping is a separate, printed step,
# because loading the overnight job starts something that commits unattended.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIBEXEC="$HOME/.local/libexec/poweranalytix"
LOGS="$HOME/Library/Logs/PowerAnalytix"
AGENTS="$HOME/Library/LaunchAgents"

# env-lib.sh is sourced by the others and is not run on its own, so it is copied
# without the executable bit. The rest find it via `cd "$(dirname "$0")"`, which
# is why they all have to land in the same directory.
SCRIPTS=(env-lib.sh check-auth-config.sh staging-keepalive.sh)
# The runner lives in the repo root, not deploy/, and does not exist yet.
RUNNERS=(overnight.sh)
PLISTS=(uk.poweranalytix.portal.staging-keepalive.plist uk.poweranalytix.portal.overnight.plist)

mkdir -p "$LIBEXEC" "$LOGS" "$AGENTS"

echo "scripts -> $LIBEXEC"
for f in "${SCRIPTS[@]}"; do
  cp "$HERE/$f" "$LIBEXEC/$f"
  [ "$f" = "env-lib.sh" ] && chmod 0644 "$LIBEXEC/$f" || chmod 0755 "$LIBEXEC/$f"
  echo "  $f"
done

for f in "${RUNNERS[@]}"; do
  if [ -f "$HERE/../$f" ]; then
    cp "$HERE/../$f" "$LIBEXEC/$f"
    chmod 0755 "$LIBEXEC/$f"
    echo "  $f"
  else
    rm -f "$LIBEXEC/$f"
    echo "  $f — not in the repo, so not installed; the overnight job stays inert"
  fi
done

echo "plists  -> $AGENTS"
for f in "${PLISTS[@]}"; do
  cp "$HERE/$f" "$AGENTS/$f"
  echo "  $f"
done

echo "logs    -> $LOGS"

echo
echo "Nothing has been started. To load, or to reload after a plist change:"
for f in "${PLISTS[@]}"; do
  label="${f%.plist}"
  loaded=""
  launchctl list "$label" >/dev/null 2>&1 && loaded="   # currently loaded — bootout first"
  echo "  launchctl bootstrap gui/\$(id -u) $AGENTS/$f$loaded"
done
echo
echo "A plist change needs a bootout + bootstrap. A script change does not —"
echo "re-running this file is enough, because the script is read at run time."

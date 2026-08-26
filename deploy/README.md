# Scheduled jobs

Two launchd jobs, deliberately separate. Neither is installed by committing it —
a person installs them, and installing the overnight one starts something that
commits code unattended.

| Job | When | What it does |
|---|---|---|
| `uk.poweranalytix.portal.overnight` | 03:00 daily | Works `TASKS.md` through the installed `overnight.sh` |
| `uk.poweranalytix.portal.staging-keepalive` | 07:00 daily | Pings `portal-staging`, then checks its auth settings |

The reasoning lives in the plists themselves, next to the lines it explains, the
way `i-love-isle-of-wight/deploy/` does it. This file is only how to install
them and what is known to be unfinished.

## The overnight runner

`./overnight.sh` takes the first eligible task in `TASKS.md`, does it on a fresh
`overnight/auto-<date>-<time>` branch, runs `npm run verify`, pushes, and opens a
pull request. It never merges and never pushes `main`.

It refuses to start rather than do something surprising. A dirty tree, a
half-finished rebase, a stale `.git/index.lock` or another run still holding the
lock each stop it with their own exit code, because the only person who reads
these is reading a log the morning after:

| Exit | Meaning |
|---:|---|
| 0 | a pull request was opened, or the queue was empty |
| 64 | the working tree was dirty |
| 65 | a rebase, merge or `index.lock` was in the way |
| 66 | another run still held the lock |
| 69 | the task was done but `npm run verify` failed - a **draft** pull request was opened |
| 70 | the headless run failed or timed out |
| 78 | a prerequisite is missing |

A failing night still pushes its branch and opens a draft. A night's work
sitting only on this Mac helps nobody, and a draft cannot be merged by accident.

Overridable, mostly so it can be exercised by hand: `PORTAL_REPO`, `CLAUDE_BIN`,
`CLAUDE_TIMEOUT` (4800s), `VERIFY_TIMEOUT` (1500s).

It was written without `i-love-isle-of-wight/overnight.sh` to hand. If the first
night fails at the headless step, compare the `claude` invocation near the top of
the file with that one before changing anything else.

### Run it once yourself first

```
cd ~/portal && ./overnight.sh
```

Same script, same guards, with somebody watching. Do that before bootstrapping
the job - loading the job is what starts something that commits unattended.

## Install

```
./deploy/install.sh
```

That copies the scripts to `~/.local/libexec/poweranalytix/`, the plists to
`~/Library/LaunchAgents/`, and creates `~/Library/Logs/PowerAnalytix/`. It starts
nothing — it prints the `bootstrap` lines instead, because loading the overnight
job starts something that commits unattended.

The keep-alive has `RunAtLoad`, so bootstrapping it is its own installation test —
check `~/Library/Logs/PowerAnalytix/staging-keepalive.log` for
`portal-staging awake (HTTP 200)`. The overnight job does not, on purpose.

Check, run now, remove:

```
launchctl list | grep poweranalytix
launchctl kickstart -p gui/$(id -u)/uk.poweranalytix.portal.staging-keepalive
launchctl bootout  gui/$(id -u)/uk.poweranalytix.portal.overnight
```

**Edit here, then re-run `install.sh`.** The installed copy is the one that runs.
A plist change also needs a `bootout` + `bootstrap`; a script change does not,
because the script is read at run time.

## Why nothing runs out of the working tree

The plists used to point straight at `deploy/*.sh`. That works until the tree is
on a branch without `deploy/` in it — and then launchd fires on schedule and the
shell says:

```
zsh:1: no such file or directory: /Users/wesleyhughes/portal/deploy/staging-keepalive.sh
```

which is what happened at 07:00 on 2026-08-26, exit 127. A scheduled job has no
business caring which branch somebody left checked out at bedtime, so the scripts
are installed exactly as the plists are: copied out, and the copy is what runs.

The logs moved out for the same reason from the other direction. `agent_logs/` is
only in `.gitignore` on the branch that introduced it, so a log written while
another branch is checked out leaves an untracked file — and an untracked file
aborts the next unattended run. launchd's own stdout and stderr now go to
`~/Library/Logs/PowerAnalytix/`. The overnight runner's detailed transcripts
still go to `agent_logs/`, which `.gitignore` does cover.

The overnight job is the same shape and gets the same treatment: it runs the
installed `overnight.sh` while its working directory stays the repo, because the
runner operates on the repo without needing to live in it. The trade is that
`install.sh` has to be re-run after editing, or a scheduled run uses a stale
copy — the same discipline the plists already needed.

Both paths are absolute and hard-coded to this machine. `StandardOutPath` and
`StandardErrorPath` have to be: launchd does not expand `$HOME` in them.

## What the overnight job is not given

No `SUPABASE_URL`, no `SUPABASE_ANON_KEY`, no `SUPABASE_SERVICE_ROLE_KEY`, no
`RESEND_API_KEY`. The suite reads staff from `tests/fixtures/staff.json` and
`playwright.config.ts` supplies its own throwaway values, so nothing in
`npm run verify` wants a real project. Absence is a stronger guarantee than a
flag: there is no variable to set wrongly and nothing to fall through to.

Two gaps that absence does not close, both stated in the plist rather than
papered over:

- **`supabase db push` authenticates with the CLI token in `~/.supabase`**, not
  with any environment variable. Withholding `SUPABASE_*` does nothing to it, so
  the plist also passes `OVERNIGHT_APPLY_MIGRATIONS=0` — which is a flag, and
  weaker for it. `BLOCKED.md` is the real rule.
- **`.env.local` is loaded by `next build` on its own** and holds live staging
  keys. A plist cannot unset a file. It is `0600` and gitignored and the nightly
  run only compiles and tests, but do not read "no Supabase variables" as "the
  run cannot see staging credentials".

## `check-auth-config.sh`

Reads `/auth/v1/settings` from the linked project and fails if it is not what
`BLOCKED.md` requires:

| Setting | Must be | Because |
|---|---|---|
| `disable_signup` | `true` | Otherwise any address on earth can request a sign-in link and get an `auth.users` row |
| `mailer_autoconfirm` | `false` | Otherwise a link need not be clicked — knowing an address is enough |
| `external.anonymous_users` | `false` | Otherwise anonymous sessions bypass the staff list |

```
./deploy/check-auth-config.sh     # 0 fine · 2 a setting is wrong · 78 cannot check
```

**It is not part of `npm run verify` and must not become part of it.** Verify
runs on fixtures, reaches no live service and needs no credential — that is what
makes it identical at 03:00 on the Mac Studio and on a laptop on a train. It is
also why it is structurally blind to this: on 2026-08-25 `portal-staging` was
found with `disable_signup: false` while verify was green, had always been
green, and would have stayed green. `src/app/actions/auth.ts` even carried a
comment asserting signups were off.

The daily keep-alive runs it, because that job already exists and already holds
the anon key. Exit codes stay distinct: `1` staging did not answer, `2` staging
answered and is configured wrongly.

It reports and does not fix. These are project settings and a person changes
them in the dashboard — `supabase config push` would be the workaround
`BLOCKED.md` forbids, and is deliberately not used.

## Why the keep-alive is a separate job

It is the one piece of scheduled work that legitimately needs a Supabase
credential. Folding it into the overnight run would hand that credential back to
the job whose whole guarantee is that it has none.

It uses the anon key and asks GoTrue for its health. Not PostgREST's root, which
answers `Only the service_role API key can be used for this endpoint`; and not
`/rest/v1/staff`, which `404`s with `PGRST205` until `0001_staff.sql` is applied
and would report a paused project when the project is fine.

# Scheduled jobs

Two launchd jobs, deliberately separate. Neither is installed by committing it —
a person installs them, and installing the overnight one starts something that
commits code unattended.

| Job | When | What it does |
|---|---|---|
| `uk.poweranalytix.portal.overnight` | 03:00 daily | Works `TASKS.md` through `./overnight.sh` |
| `uk.poweranalytix.portal.staging-keepalive` | 07:00 daily | Pings `portal-staging`, then checks its auth settings |

The reasoning lives in the plists themselves, next to the lines it explains, the
way `i-love-isle-of-wight/deploy/` does it. This file is only how to install
them and what is known to be unfinished.

## The overnight job has no runner yet

`./overnight.sh` **does not exist in this repository.** The plist is written and
correct, and until somebody writes or adapts that script the job will start,
find nothing to run, and write

```
[2026-08-25 03:00:00] FATAL: ./overnight.sh is not present — the portal has no runner yet
```

to `agent_logs/launchd.out.log` and exit 78. That is deliberate: the failure mode
worth avoiding is the silent one. `i-love-isle-of-wight/overnight.sh` is the
model — it needs `TASKS.md` and `CLAUDE.md` in the working directory, which this
repo has.

Installing the keep-alive on its own is fine and useful today.

## Install

```
cp deploy/uk.poweranalytix.portal.overnight.plist         ~/Library/LaunchAgents/
cp deploy/uk.poweranalytix.portal.staging-keepalive.plist ~/Library/LaunchAgents/

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/uk.poweranalytix.portal.staging-keepalive.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/uk.poweranalytix.portal.overnight.plist
```

The keep-alive has `RunAtLoad`, so bootstrapping it is its own installation test —
check `agent_logs/staging-keepalive.log` for `portal-staging awake (HTTP 200)`.
The overnight job does not, on purpose.

Check, run now, remove:

```
launchctl list | grep poweranalytix
launchctl kickstart -p gui/$(id -u)/uk.poweranalytix.portal.staging-keepalive
launchctl bootout gui/$(id -u)/uk.poweranalytix.portal.overnight
```

**Edit the copy in this repo, not the one in `~/Library/LaunchAgents`,** then
copy across and re-bootstrap. The other repo has the two in sync today; it is an
easy pair to let drift, and the installed copy is the one that runs.

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

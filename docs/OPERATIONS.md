# Operations

How each scheduled job on the Mac Studio decides what to do, where a person is
required, and what is known not to be guarded. `deploy/README.md` is how to
install them; this is how they behave once installed. Written from a read of
`overnight.sh` and `deploy/` at `5d10a6b` on 26 September 2026. Updated on 27
September for self-correction and the merge gate, and on 30 September for the
loop, the roadmap, the nightly report and the catch-up.

## The jobs

| Label | When (UK local) | Runs |
|---|---|---|
| `uk.poweranalytix.portal.overnight` | 03:00 and 12:30 daily, and at load — runs once a day | `~/.local/libexec/poweranalytix/overnight.sh`, cwd `~/portal` |
| `uk.poweranalytix.portal.staging-keepalive` | 07:00 daily, and at load | `~/.local/libexec/poweranalytix/staging-keepalive.sh` |
| `uk.poweranalytix.portal.rc` | at load, then every 10 min | `~/.local/libexec/poweranalytix/rc-keepalive.sh` |

launchd runs on local time, so these do not move when the clocks change. All
three are LaunchAgents: they run only while somebody is logged in. With
FileVault on and no automatic login, after a power cut nothing here runs until
a person types the password at the Mac. The overnight job catches up when
that happens: see "Never miss a night".

## overnight.sh

A night is a loop: task after task, each on its own branch with its own pull
request, each merged only if the gate passes, until the night reaches
something only Wesley can do. It then says exactly what that is.

### Before the loop

1. `cd ~/portal`, or **exit 78**. Load `task-headings.sh`, `merge-gate.sh` and
   `night-loop.sh` from beside the installed script, before anything is
   checked out (**78** if they are missing).
2. `git`, `node`, `npm`, `gh` and `claude` must be on PATH, or **78**.
   `TASKS.md` and `CLAUDE.md` must exist, or **78**.
3. Take the lock `~/Library/Caches/uk.poweranalytix.portal.overnight.lock`
   (`mkdir`, atomic). If its PID is alive, **exit 66**. If it is dead, reclaim it.
4. **Once a day.** If `~/.local/state/poweranalytix/last-start` holds today's
   date, exit **0** at once. That check happens here, while the run holds the
   lock, so two fires can't both see "not yet".
5. `.git/index.lock` exists → **65**. A rebase, merge or cherry-pick is in
   progress → **65**. It never deletes or aborts either.
6. `git status --porcelain` is non-empty → **64**. Untracked files count. Stashes
   are logged but do not stop the run. Only once the tree is clean does it write
   today's date to `last-start`, so a dirty tree still exits 64 at every fire
   until somebody tidies it.
7. **The window.** A run that starts before 06:00 starts no task after 06:00
   and is over by 07:00. A catch-up that starts later gets the same three hours
   from when it starts, plus one hour of grace.
8. `git fetch --prune origin` (**78** on failure), `git checkout main`, then
   `git merge --ff-only origin/main` (**65** if they have diverged).
9. **Is the right runner running?** The installed scripts and plist are
   compared with main's. A difference goes in the report as "run
   `./deploy/install.sh`". Nothing is changed.
10. **An unconfirmed merge from an earlier night.** If
    `~/.local/state/poweranalytix/merge-in-flight` exists, production is
    checked now. If it passes, the marker is cleared. Otherwise it stays, and
    the loop starts nothing.

### The loop (`night_loop`, `deploy/night-loop.sh`)

Before every task, the loop stops if any of these holds, and logs which:

| Stop | Because |
|---|---|
| Claude reported a usage or rate limit | a limit does not lift in five minutes, and retrying it is the loop to avoid |
| a revert happened | production broke tonight |
| the kill switch is on | a person said stop |
| a merge was never confirmed healthy | one at a time means one at a time |
| 2 tasks in a row failed | something is wrong beyond the task |
| 6 tasks attempted | a night's ceiling |
| past 06:00 (or the catch-up's cutoff) | no task starts after it |
| no eligible task left | and the planner had nothing more (below) |

Otherwise it goes on:

1. Refresh: tree clean, fetch, main fast-forwarded, `TASKS.md` from main, and
   the open pull requests. If any of those fails, the night stops.
2. **Eligible** means a `### T-n` under a "Next up" heading that:
   - has no open `overnight/auto-*` pull request building it (a
     `Task: T-n` line, or its branch having taken T-n out of Next up; drafts
     count);
   - isn't named under `## Held`;
   - has every `After T-m` already in Done on main;
   - hasn't been attempted tonight.

   Headings without an ID are never picked, and the log lists them.
3. **Fewer than two eligible**, so the planner runs (see "The roadmap and the
   planner"). Its pull request is merged and deployed before the loop goes on.
   It runs at most twice a night, and not again after a refusal.
4. **Build the first eligible task**, in a subshell, so its exits end the task
   and not the night:
   - branch `overnight/auto-<date>-<time>-t-n` from the current main;
   - the ignore checks, and `npm ci` if the lockfile moved;
   - the baseline `npm run verify`, measured once per main commit;
   - the agent;
   - a retry for transient errors, a nudge to commit, and up to two fixes;
   - verify, push, and a pull request (a draft if it's red);
   - the gate;
   - on a merge, the production check, and a revert if it fails.
5. What the task's exit means (`outcome_for_exit`):

| Task ended | Counts as | The loop |
|---|---|---|
| merged, production healthy | merged | goes on; the failure run resets |
| the gate refused, PR left open | held | goes on to the next task, and tasks that are `After` it wait |
| the agent replied `BLOCKED:` | blocked | goes on; the report names what it needs |
| 69 (verify red, draft), 70 (agent failed or didn't finish), 78, or nothing done | failed | goes on; two in a row stop it |
| 71 / 72 (reverted; revert failed) | reverted | stops |
| 75 (usage or rate limit) | rate-limited | stops, no retry |
| 64 / 65 / 66 | stop | stops |

**One merge at a time.** A task returns only after its merge has deployed and
been smoke-tested. The gate writes `merge-in-flight` before `gh pr merge`, and
only a passing production check removes it. While the marker exists, gate
condition h refuses any other merge and the loop starts no task.

**The agent's time.** Each task gets the agent's 80 minutes plus verify's 25,
counted from the moment the agent starts, and never runs past the hard stop
minus 25 minutes. That leaves time for the checks wait and the production
watch. Retries and fixes come out of the same budget.

A transient failure gets one retry. That means the headless run exits
non-zero with one of these in its last lines: `ENOTFOUND`, `ECONNRESET`,
`ETIMEDOUT`, `EAI_AGAIN`, `ECONNREFUSED`, "socket hang up", "overloaded", or an
API 5xx or 529. A **usage or rate limit** ("usage limit", "rate limit", 429,
"limit reached" and so on) is checked first. It is never retried: the task
ends with 75 and the night stops.

### After the loop

The report (below) is written, posted, and saved. The night exits with the
worst code among 72, 71, 75 and 64–66, or **0**.

### With `--dry-run`

It prints the queue and the plan, and builds nothing:

```
WOULD WAIT: T-4, until T-1 is merged
WOULD SKIP: T-1, its pull request #53 is open
WOULD PLAN R-1 — … (from main)
WOULD BUILD: T-2, T-3, new-task-from-R-1
WOULD STOP BECAUSE: roadmap exhausted — needs Wesley
```

It assumes each task is merged or held; a failure, a revert, a limit or the
clock can stop a real night sooner. It also says whether a run has started
today. It then probes claude by having it write and commit a file on a scratch
branch, and runs the gate against that commit. Last, it prints the NEEDS WESLEY
list the report would carry.

It pushes, posts, merges and comments on nothing. It neither reads nor writes
`last-start`. It puts the checkout back where it found it. Run from a checkout
whose main has no `docs/ROADMAP.md` yet, it reads the checkout's copy and says
so.

**It will never:**
- push to `main`;
- merge by any route but `merge_gate`, and there only with `gh pr merge`,
  never `--admin`;
- merge a draft, a red PR, or anything touching a protected path;
- merge while an earlier merge is unconfirmed in production;
- edit `docs/ROADMAP.md`, or queue a task the roadmap doesn't name;
- apply a migration from the script;
- start on a dirty tree, abort someone else's rebase or merge, or delete
  `.git/index.lock`;
- pass any `SUPABASE_*` or `RESEND_*` variable to the agent.

## The roadmap and the planner

`docs/ROADMAP.md` is the **only** source of new work. It is Wesley's, and it is
a protected path, so the gate never merges a change to it. It has two lists:

- **Ready to build**, items headed `### R-n — Title`, which need no decision;
- **Needs Wesley first**, which the planner never reads as work.

A `Status: DRAFT` line anywhere makes the planner refuse the whole file.

When fewer than two tasks are eligible, `plan_one` does this:

1. Exits as **draft** or **exhausted** if the roadmap is marked DRAFT, or has
   no Ready item that isn't already a task. An item is already a task if some
   task in `TASKS.md` has `Source: ROADMAP — R-n`.
2. Exits as **refused** if an earlier planner pull request (`overnight/plan-*`)
   is still open. It won't queue the same items twice.
3. Hands the agent up to **three** Ready items, and up to **two** fixes for
   pull requests that failed tonight. It gives each an ID one above anything
   in use. Each task must have:
   - a `Source: ROADMAP — R-n — Title` line (or `Source: FIX — #n`);
   - a `Size: S|M|L` line;
   - a **Done when** line.
4. Runs `planner_check` on the result before anything is opened. It must hold
   that:
   - only `TASKS.md` changed, and no line was removed or rewritten;
   - Done is unchanged;
   - every new ID is new;
   - every task names a Ready item that has no task yet, or a pull request
     that failed tonight;
   - there are at most three roadmap tasks and two fixes.

   A plan that fails is not opened; the report says why.
5. Opens the pull request (`plan: queue T-a T-b from ROADMAP`) and runs it
   through the gate in **plan mode**. There, c) is `planner_check` itself, and
   a) doesn't ask for local verify, since only `TASKS.md` changed. CI's
   `verify` is still required, by b) and by branch protection. On a merge, it
   waits for production like any other.

If the roadmap has nothing Ready and nothing is eligible, the night stops with
**"roadmap exhausted — needs Wesley"**.

"T-fix" tasks are ordinary `### T-n` tasks whose title starts "Fix:" and whose
source is `FIX — #n`, the pull request that failed. The ID stays numeric
because every part of the runner agrees on `T-<number>`.

## The nightly report

At the end of every night that gets past the preflight, one report goes to:

- a comment on the open issue **"Power Suite nightly reports"** in
  `BigWez79/portaltest`. The first night creates the issue and pins it;
- `~/Library/Logs/PowerAnalytix/nightly-report.md`, the same text.

It has:
- one line for each task tried, with its pull request: merged (with the live
  check result), held (with the gate's reasons), failed, or blocked;
- one line for each task skipped, and why: an open PR, waiting on a parent, or
  under Held;
- why the night stopped;
- **NEEDS WESLEY**, a numbered list with the exact action for each item:
  - every open pull request, however old. One with a migration reads "apply
    `0012_margin_split.sql` in the Supabase SQL editor, then review and merge
    …", and the protected paths and size are named;
  - a draft to fix or close;
  - a `BLOCKED:` task, and what it needs;
  - the kill switch or an unconfirmed merge, with the command that clears it;
  - a DRAFT or exhausted roadmap, naming the Needs Wesley first items;
  - an installed runner or plist that doesn't match main, with the commands.

If `gh` can't post, the file is still written and the log says so.

## Never miss a night

On 29 September at 23:01 the Mac restarted, with no clean shutdown recorded,
and sat at the FileVault login screen. LaunchAgents don't run there, so the
30th had no night. The catch-up makes that a late night rather than a lost one:

- the overnight plist fires at **03:00**, at **12:30**, and **at load**, which
  is every login and every bootstrap;
- the first fire of a day that gets past the preflight runs a normal night,
  with the three-hour window counted from its start;
- every later fire that day exits **0** at once, before it touches the
  repository or `gh`;
- a dirty tree still exits **64** at every fire, and doesn't use up the day.

**Loading the job starts a run** if none has started today. To bootstrap
without one, mark the day first:

```
mkdir -p ~/.local/state/poweranalytix && date +%F > ~/.local/state/poweranalytix/last-start
```

`scripts/test-catch-up.sh` runs the real `overnight.sh` to check all of this.

What the Mac itself does is reported here, not changed by the build. Read on
30 September 2026 (macOS 27.0.1):

| Setting | As found | Can it stop a night? |
|---|---|---|
| Install macOS updates (`AutomaticallyInstallMacOSUpdates`) | **off**. Download is on, and Security Responses and system files is on. | Not by itself. 27.0.1 was installed at 15:10 on the 30th, with a login password entered a minute before — not overnight. |
| FileVault | **on** | Yes. After any restart nothing runs until someone logs in. The catch-up runs the night at that login. |
| Automatic login | **off** (and macOS doesn't allow it with FileVault on) | That is the restart case above. |
| `pmset -g sched` | nothing scheduled | No. `sleep 0`, so the Mac never sleeps and needs no wake. `autorestart 1` powers it back on after a power cut, to the login screen. |

## Auto-merge

Decided by Wesley on 26 September 2026: the nightly build may merge its own
pull request into main, which deploys straight to the live Power Suite. It may
do that only when the merge gate passes. The gate is code, not prompt wording.
Anything it refuses waits for a person, as before. BLOCKED.md records this
under "Release".

### The gate

`merge_gate` in `overnight.sh` gathers the facts. `gate_evaluate` in
`deploy/merge-gate.sh` decides, and every condition must hold:

| | Condition | Measured by |
|---|---|---|
| a | Local `npm run verify` passed on the final commit, and the PR is not a draft | the run's own verify; `gh pr view --json isDraft` |
| b | Every GitHub check passed, including one named `verify` | `gh pr checks --watch`, capped at 20 min, then read back as JSON |
| c | Exactly one task left Next up, it is in Done, and it is the task this run was given. No task was added. | `TASKS.md` on `origin/main` vs the branch, by ID |
| d | No protected path is touched | `git diff --no-renames --name-only origin/main...HEAD` against `PROTECTED_PATHS` |
| e | No test file deleted; no `.only`, `.skip` or `.fixme` added; no fewer tests pass than on main | name-status, added lines in test files, and the baseline vs final verify counts |
| f | Under 800 changed lines, excluding `TASKS.md`. A binary file counts as 800. | `git diff --numstat` |
| g | The kill switch is off | `~/.config/poweranalytix/automerge-off` does not exist |
| h | No earlier merge is still waiting for its production check. (This replaced "one merge a night" on 30 September.) | `~/.local/state/poweranalytix/merge-in-flight`, written just before `gh pr merge` and removed only when production passes |
| i | At least 15 minutes left before the night's hard stop, to watch the deploy | the clock |

The planner's pull requests go through the same gate in **plan mode**. There,
c) is `planner_check`: only `TASKS.md` changes, lines are only added, and every
new task names a Ready roadmap item or a PR that failed tonight. a) asks only
that it isn't a draft. e) asks that no test file is touched.

If every condition holds, the gate runs `gh pr merge <n> --squash --delete-branch`.
If any fails, the PR stays open, gets a comment listing exactly which
conditions failed, and the log says the same.

### Protected paths

They're listed in one place, `PROTECTED_PATHS` at the top of `overnight.sh`:
- `supabase/**`;
- sign-in and sessions: `src/app/auth/**`, the sign-in action, the test-mode
  sign-in routes, `src/proxy.ts`, the Supabase clients, and the env, session,
  current-user, guard, staff and rate-limit helpers;
- the runner and gate: `overnight.sh`, `deploy/**`, `scripts/**`;
- `.github/**`, the Playwright config, `tests/harness.ts` and
  `tests/global-setup.ts`;
- `CLAUDE.md`, `BLOCKED.md` and `docs/ROADMAP.md`;
- `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json` and
  `vercel.json`;
- `.env*` and `.gitignore`.

A PR that changes the gate is itself protected, so it always waits for a person.

### The kill switch

```
mkdir -p ~/.config/poweranalytix && touch ~/.config/poweranalytix/automerge-off   # stop all merging
rm ~/.config/poweranalytix/automerge-off                                          # allow it again
```

Nothing else needs changing. The gate reads the file on every run.

### After a merge, and the revert

1. Wait for Vercel's **Production** deployment of the merge commit, via
   `gh api repos/BigWez79/portaltest/deployments`, capped at 15 minutes.
2. Smoke-test `PRODUCTION_URL` (`https://portaltest-sigma.vercel.app` until the
   cutover). `/` must return **200**, because that's the sign-in page and
   there's no `/login`. `/admin` must redirect to `/?next=%2Fadmin`, which shows
   the proxy ran and turned a signed-out visitor away without crashing.
3. **If the deployment or the smoke test fails:**
   - branch `overnight/revert-<date>-pr<n>`, `git revert` the merge, verify,
     push and open a PR;
   - merge it through the same gate in **revert mode**. There, c becomes "it
     touches exactly the paths the merge touched", e becomes "it restores
     those files exactly", and h and i don't apply.
   - Then re-check production. If it's healthy → **exit 71**.
4. **If any part of the revert fails:** the runner turns the kill switch on,
   comments on the PR, and exits **72**. Everything is left for a person.

### Exit codes added

| Exit | Meaning |
|---:|---|
| 71 | Merged, production failed its check, the merge was reverted through the gate, and production is healthy again |
| 72 | Merged, production failed, and the revert could not be completed. The kill switch is **on**. |
| 70 | Also used now when the agent ends without committing and its files are published as a draft |
| 75 | Claude reported a usage or rate limit. The night stopped cleanly, with no retry. |

Since 30 September these are what one **task** ends with, inside the loop.
The night's own exit is the worst of 72, 71, 75 and 64–66, or 0. The report
says which task ended how.

## staging-keepalive.sh

1. Read `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `~/portal/.env.local`.
   If the file is unreadable, or either variable is empty, exit **78**.
2. `GET <SUPABASE_URL>/rest/v1/staff?select=id&limit=1` with the anon key, with a
   20 s limit. This is a real query, so it counts as activity. The health
   endpoint does not.

| Response | Meaning | Exit |
|---|---|---|
| `200` | Staging is awake. RLS returns `[]` to anon. | continue |
| `401` / `403` | The anon key in `.env.local` is wrong or rotated | 1 |
| `404` (`PGRST205`) | The `staff` table is missing, so a migration has not been applied | 1 |
| `000` | No answer in 20 s. Either the network is down or the project is paused. | 1 |
| anything else | Unexpected. The code is logged. | 1 |

3. Then run `check-auth-config.sh`. It exits **2** if `disable_signup` is not
   `true`, if `mailer_autoconfirm` is not `false`, or if anonymous users are on.
   It reports and does not fix.

## rc-keepalive.sh

1. `tmux` or `claude` is missing → **78**.
2. tmux session `suite` exists → exit 0, silently.
3. `~/portal-rc` doesn't exist → **78**, and the log prints the `git worktree add`
   line. The job never creates the worktree itself.
4. `~/portal-rc` has `main` checked out → **78**. Git allows a branch to be
   checked out in one worktree at a time, so the 03:00 run would fail.
5. Otherwise, start `claude --remote-control "Power Suite"` detached in session
   `suite`, in `~/portal-rc`.

One-time setup, by a person:

```
brew install tmux
git -C ~/portal worktree add ~/portal-rc -b overnight/rc-desk origin/main
cd ~/portal && ./deploy/install.sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/uk.poweranalytix.portal.rc.plist
```

The worktree branch is `overnight/rc-desk`, not `rc/desk`, because CLAUDE.md
allows `overnight/*` branches only. To attach at the Mac: `tmux attach -t suite`.

## Where a person is required

The nightly report's NEEDS WESLEY list is this section, filled in for the
night.

- **The roadmap.** Writing `docs/ROADMAP.md`, answering its "Needs Wesley
  first" items, and deleting the `Status: DRAFT` line. The machine never edits
  it.
- **Merging** whatever the gate refuses: drafts, protected paths, anything
  over the size limit, and every PR while the kill switch is on. A PR that touches `CLAUDE.md` or `BLOCKED.md` is always merged
  by a person.
- **Removing the kill switch** after an exit 72, once production has been
  looked at. Likewise `merge-in-flight`, if a merge was never confirmed.
- **Migrations.** They are written and committed by the machine. A person
  applies them by typing `! supabase db push` themselves.
- **Secrets.** Creating and rotating keys, putting them in Vercel, and putting
  them in `~/portal/.env.local`, which the keep-alive needs.
- **DNS and SMTP.** GoDaddy DNS, the domain cutover, and Supabase Auth's SMTP.
- **Supabase project settings.** Signups, autoconfirm, redirect URLs, email
  templates, and unpausing a paused project.
- **This Mac.** Typing the FileVault password after a power cut (the night
  then runs as a catch-up), re-running `deploy/install.sh` after a merge that
  changes `deploy/` or `overnight.sh`, and loading or unloading jobs.
- **`BLOCKED:` nights.** Nothing moves until someone does what the task needs.

## Known gaps

- **Stalls are guarded in code now, and any open PR holds its task.** That
  includes a draft nobody is looking at. A draft on `overnight/auto-*` stops
  its task being built again until a person merges or closes it.
- **Retries cover the agent only.** A failed `git fetch`, push, or
  `gh pr create` still ends the night (78).
- **"Weakened" means what a script can see.** Deleted tests, `.only`/`.skip`/
  `.fixme`, and a lower passing count. An assertion changed to expect the wrong
  value passes the gate. The fix prompt forbids it, and nothing enforces that.
- **The agent could still run `gh pr merge` itself.** It has a shell,
  `--dangerously-skip-permissions`, and this Mac's `gh` login. The prompt
  forbids it. Branch protection (required `verify`, no admin bypass) is what
  stops a red merge, not the prompt.
- **Node.** `.nvmrc` says `22`, but the machine runs Homebrew Node 26
  (`/opt/homebrew/bin/node`), and nothing reads `.nvmrc`. `engines` only asks for
  `>=20.9.0`, so it passes. CI and Vercel may be running a different major.
- **The `.tmp` check fails on a fresh checkout.** `.gitignore` has `.tmp/`, a
  directory-only pattern. The Mac Studio has `.tmp` in `.git/info/exclude` to
  cover it; any other checkout doesn't.
- **The installed copy is what runs.** A merge that changes `deploy/` or
  `overnight.sh` has no effect until `deploy/install.sh` is re-run. The night
  now notices the drift and puts it in the report, but it doesn't fix it.
- **The planner's tasks are only as good as the roadmap's items.**
  `planner_check` proves each task names a Ready item. It can't prove the task
  says the same thing as the item. The planner is told not to widen an item,
  and nothing enforces that. Read the planner's PRs, which are small.
- **A task that fails leaves its branch.** A failure before the push (agent
  timeout, rate limit) leaves its commits on a local `overnight/auto-*` branch
  that nobody will see. The report names it.
- **The catch-up's clock is its own.** A run that starts at 12:30 builds until
  15:30 and deploys to production in working hours. That is the price of not
  losing the night.
- **Nothing structural stops the agent running `supabase db push`.** See
  `deploy/README.md`. Whether the CLI is logged in decides whether it could.

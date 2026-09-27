# Operations

How each scheduled job on the Mac Studio decides what to do, where a person is
required, and what is known not to be guarded. `deploy/README.md` is how to
install them; this is how they behave once installed. Written from a read of
`overnight.sh` and `deploy/` at `5d10a6b` on 26 September 2026. Updated on 27
September for self-correction and the merge gate.

## The jobs

| Label | When (UK local) | Runs |
|---|---|---|
| `uk.poweranalytix.portal.overnight` | 03:00 daily | `~/.local/libexec/poweranalytix/overnight.sh`, cwd `~/portal` |
| `uk.poweranalytix.portal.staging-keepalive` | 07:00 daily, and at load | `~/.local/libexec/poweranalytix/staging-keepalive.sh` |
| `uk.poweranalytix.portal.rc` | at load, then every 10 min | `~/.local/libexec/poweranalytix/rc-keepalive.sh` |

launchd runs on local time, so these do not move when the clocks change. All
three are LaunchAgents: they run only while somebody is logged in. With
FileVault on and no automatic login, after a power cut nothing here runs until
a person types the password at the Mac.

## overnight.sh

1. `cd ~/portal`, or **exit 78**. Load `task-headings.sh` and `merge-gate.sh`
   from beside the installed script, before anything is checked out (**78** if
   they are missing).
2. `git`, `node`, `npm`, `gh` and `claude` must be on PATH, or **78**.
   `TASKS.md` and `CLAUDE.md` must exist, or **78**.
3. Take the lock `~/Library/Caches/uk.poweranalytix.portal.overnight.lock`
   (`mkdir`, atomic). If its PID is alive, **exit 66**. If it is dead, reclaim it.
4. `.git/index.lock` exists → **65**. A rebase, merge or cherry-pick is in
   progress → **65**. It never deletes or aborts either.
5. `git status --porcelain` is non-empty → **64**. Untracked files count. Stashes
   are logged but do not stop the run.
6. `git fetch --prune origin`. If that fails (no network, no credential),
   **78**.
7. `git checkout main`, or **78**, then `git merge --ff-only origin/main`. If
   they have diverged, **65**.
8. **Pick the task, in code.**
   - List the open PRs on `overnight/auto-*`, drafts included. If `gh` can't
     list them, **78**.
   - A PR is building task T-n if its body has a `Task: T-n` line, or its
     branch has taken T-n out of Next up.
   - Take the first `### T-n` under a "Next up" heading on `origin/main` that
     no open PR is building.
   - Headings without an ID are never picked, and the log lists them.
   - If nothing is eligible, exit **0** and log either
     `queue blocked by open PRs: #…` or `QUEUE EMPTY`.
9. Create `overnight/auto-YYYY-MM-DD-HHMM`.
10. `node_modules`, `.tmp`, `playwright-report` and `test-results` must be
    ignored, or **78**.
11. With `--dry-run`:
    - probe claude by having it write and commit a file;
    - run the merge gate against that commit;
    - print each condition and `WOULD MERGE: yes/no`;
    - delete the branch and exit **0**.

    It merges, pushes and comments on nothing.
12. `npm ci` if the lockfile moved. Then **baseline**: `npm run verify` on main,
    recording how many tests pass. If main is red, the night goes on, but
    nothing it does can merge.
13. **The agent** is told the task ID, and only that task. Its rules:
    - commit on this branch; don't create a branch, push, open a PR, or merge;
    - run everything in the foreground;
    - don't apply migrations;
    - reply `BLOCKED:` if the task needs something from BLOCKED.md;
    - move the task to Done, keeping its ID.

    It is not told how the gate decides, and it has no part in the decision.
14. **Budget.** The agent's 80 minutes plus verify's 25 are counted from the
    moment the agent starts. Retries and fixes come out of that budget.
15. **A transient failure gets one retry.** If the headless run exits non-zero
    with one of these in its last lines, the runner waits 5 minutes and tries
    once more, telling the agent to carry on from what is already on the branch:
    `ENOTFOUND`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `ECONNREFUSED`,
    "socket hang up", "overloaded", or an API 5xx or 529. A timeout is not
    retried. Any other failure → **70**.
16. **No commits, no changes:** if the agent replied `BLOCKED:`, log it, delete
    the branch and exit **0**. Otherwise it did nothing: exit **0**.
17. **Changes but no commits** (what happened on 27 September). The runner asks
    the agent once, in the same conversation, to finish and commit. If it still
    doesn't, the files are committed by the script and published as a **draft**
    → **70**.
18. Leftovers are swept into a commit, unless they look like secrets → **64**.
19. **Verify, then fix.** If `npm run verify` fails, the agent gets the last
    120 lines and up to **two** fix attempts, each followed by verify, while at
    least 15 minutes of budget remain. It may fix code. It may not delete, skip
    or weaken tests, or touch the machinery.
20. Push. Still red → **draft** PR → **69**. Otherwise a ready PR, whose first
    body line is `Task: T-n`.
21. Close any draft it supersedes (see `supersede_drafts`).
22. **The merge gate** decides. See below.
23. Clean-up (EXIT trap), only on its own branch: commit leftovers that don't
    look like secrets, check out main, release the lock.

**It will never:**
- push to `main`;
- merge by any route but `merge_gate`, and there only with `gh pr merge`,
  never `--admin`;
- merge a draft, a red PR, or anything touching a protected path;
- apply a migration from the script;
- start on a dirty tree, abort someone else's rebase or merge, or delete
  `.git/index.lock`;
- pass any `SUPABASE_*` or `RESEND_*` variable to the agent.

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
| h | Nothing has merged yet that night | `~/.local/state/poweranalytix/last-merge` |

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
- `CLAUDE.md` and `BLOCKED.md`;
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
     those files exactly", and h doesn't apply.
   - Then re-check production. If it's healthy → **exit 71**.
4. **If any part of the revert fails:** the runner turns the kill switch on,
   comments on the PR, and exits **72**. Everything is left for a person.

### Exit codes added

| Exit | Meaning |
|---:|---|
| 71 | Merged, production failed its check, the merge was reverted through the gate, and production is healthy again |
| 72 | Merged, production failed, and the revert could not be completed. The kill switch is **on**. |
| 70 | Also used now when the agent ends without committing and its files are published as a draft |

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

- **Merging** whatever the gate refuses: drafts, protected paths, anything
  over the size limit, a second PR in one night, and every PR while the kill
  switch is on. A PR that touches `CLAUDE.md` or `BLOCKED.md` is always merged
  by a person.
- **Removing the kill switch** after an exit 72, once production has been
  looked at.
- **Migrations.** They are written and committed by the machine. A person
  applies them by typing `! supabase db push` themselves.
- **Secrets.** Creating and rotating keys, putting them in Vercel, and putting
  them in `~/portal/.env.local`, which the keep-alive needs.
- **DNS and SMTP.** GoDaddy DNS, the domain cutover, and Supabase Auth's SMTP.
- **Supabase project settings.** Signups, autoconfirm, redirect URLs, email
  templates, and unpausing a paused project.
- **This Mac.** Typing the FileVault password after a power cut, re-running
  `deploy/install.sh` after a merge that changes `deploy/` or `overnight.sh`,
  and loading or unloading jobs.
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
  `overnight.sh` has no effect until `deploy/install.sh` is re-run. Nothing
  detects the drift.
- **Nothing structural stops the agent running `supabase db push`.** See
  `deploy/README.md`. Whether the CLI is logged in decides whether it could.

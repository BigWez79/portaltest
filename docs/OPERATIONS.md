# Operations

How each scheduled job on the Mac Studio decides what to do, where a person is
required, and what is known not to be covered. Written from the scripts as they
stand on `main` on 2026-09-26. If this file and a script disagree, the script is
what runs. Fix this file.

`deploy/README.md` covers installing the jobs. This file covers their behaviour.

## The jobs

| Label | When (UK local time) | Runs |
|---|---|---|
| `uk.poweranalytix.portal.overnight` | 03:00 daily | `~/.local/libexec/poweranalytix/overnight.sh` |
| `uk.poweranalytix.portal.staging-keepalive` | 07:00 daily, and at load | `~/.local/libexec/poweranalytix/staging-keepalive.sh` |
| `uk.poweranalytix.portal.rc` | at load, then every 10 minutes | `~/.local/libexec/poweranalytix/rc-keepalive.sh` |

launchd fires on local time. If the Mac is asleep at the scheduled time, the
job runs on wake. It is not skipped.

## overnight.sh: one task, one branch, one pull request

1. **Re-exec guard.** If it is running from inside `~/portal`, it copies itself
   to `~/Library/Caches/…running.sh` and re-execs. Checking out `main` would
   otherwise rewrite the file the shell is reading.
2. **Repo present?** `cd ~/portal`, or exit **78**.
3. **Tools on PATH?** `git node npm gh claude`, or exit **78**.
4. **`TASKS.md` and `CLAUDE.md` present?** If not, exit **78**.
5. **Lock.** `mkdir ~/Library/Caches/uk.poweranalytix.portal.overnight.lock`.
   If it exists and its PID is alive, exit **66**. If that PID is dead, it
   reclaims the lock.
6. **Git state.** A `.git/index.lock`, or an unfinished rebase, merge or
   cherry-pick, exits **65**. It is reported, not removed.
7. **Clean tree?** Any `git status --porcelain` output exits **64**. Stashes are
   reported but do not stop the run.
8. **Fetch.** `git fetch --prune origin`, or exit **78**. It does not retry.
9. **Up-to-date main.** It checks out `main` and runs `merge --ff-only
   origin/main`. If main has diverged, exit **65**.
10. **Branch.** It creates `overnight/auto-YYYY-MM-DD-HHMM` from `main`.
11. **Ignore check.** `node_modules`, `.tmp`, `playwright-report` and
    `test-results` must all be ignored, or exit **78**.
    *Known flaw:* `.gitignore` has `.tmp/`, a directory-only pattern, and
    `git check-ignore .tmp` only matches it when `.tmp/` exists. On a night when
    `.tmp/` is absent this exits 78. It happened at 19:07 on 2026-09-26.
12. **`--dry-run`** asks the agent to write and commit one file, checks for the
    commit, deletes the scratch branch and returns to the starting branch. It
    exits 0, or **70** if no commit was made.
13. **Dependencies.** `npm ci` runs only if `node_modules` is missing or older
    than `package-lock.json`. If `npm ci` fails, exit **78**.
14. **What is already claimed.** Every open **non-draft** PR on an `overnight/*`
    branch is read. A `### ` heading that is under "Next up" on `main` but
    missing from that branch's `TASKS.md` counts as claimed. Headings are
    compared by title, ignoring numbers (see `deploy/task-headings.sh`). Drafts
    never claim a task, because a draft means verify failed and the task needs
    doing again.
15. **Picking the task.** The agent is told to take the **first** task under
    "Next up" that is not in Held, not in Done and not in the claimed list.
    - Nothing eligible: it replies `QUEUE EMPTY` and makes no commit.
    - Task needs something in `BLOCKED.md`: it replies `BLOCKED: …` and makes
      no commit.
16. **What the agent is told.** It runs `claude -p
    --dangerously-skip-permissions` with an 80-minute timeout.
    - **May:** read `CLAUDE.md` and `BLOCKED.md` first, do one task, commit on
      the current branch, write migrations, and move the task to Done with the
      branch name.
    - **May not:** create or switch branches, push, open a PR, merge, apply a
      migration (`supabase db push` or any other route), work around
      `BLOCKED.md`, guess at criteria it cannot check at 3am, or leave anything
      uncommitted or stashed.
17. **Headless run failed or timed out** → exit **70**.
18. **No commits made.**
    - Files left behind: the branch is kept and it exits 0.
    - Reply was `BLOCKED:`: the reason is logged, the branch is deleted and it
      exits 0.
    - Otherwise the queue is empty: the branch is deleted and it exits 0.
19. **Leftovers.** Uncommitted files are checked by `looks_like_a_secret`
    (filename patterns, and content patterns in untracked files). A match exits
    **64** and the tree is left for a person. Otherwise it commits them as a
    sweep.
20. **Verify.** `npm run verify` runs with a 25-minute timeout. Its log goes to
    `~/Library/Logs/PowerAnalytix/verify-*.log`.
21. **Push.** `git push -u origin <branch>`, or exit **78**. It does not retry.
    The commits stay local.
22. **Pull request.**
    - Verify passed: it opens a **ready** PR titled `overnight: <date>`, then
      closes any open **draft** `overnight/*` PR that claimed the same task
      heading, as superseded. Exit **0**.
    - Verify failed: it opens a **draft** PR titled `… — verify FAILED` with the
      last 60 lines of verify in the body. Exit **69**.
23. **Clean-up (EXIT trap).** Only if this run made the branch: leftovers are
    committed unless they look like a secret, then it checks out `main` and
    releases the lock. If the tree is dirty on some other branch, it is left
    alone.
    *Known flaw:* a fatal exit after step 10 (for example step 11) leaves the
    local `overnight/auto-*` branch behind. `overnight/auto-2026-09-26-1907` is
    one.

**It will never:** push to `main`, merge, apply a migration itself, pass a
Supabase or Resend variable to the agent, commit on a tree it did not dirty, or
delete an `index.lock` or abort a rebase.

## staging-keepalive.sh: keeping portal-staging from pausing

1. Reads `~/portal/.env.local` (`env-lib.sh`). If the file is not readable, or
   `SUPABASE_URL` or `SUPABASE_ANON_KEY` is empty, it exits **78**.
2. Calls `GET <SUPABASE_URL>/rest/v1/staff?select=id&limit=1` with the anon key
   and a 20-second limit. This is a real database read, so it counts as
   activity. Under RLS it returns an empty array.

| Response | Meaning | Exit |
|---|---|---|
| 200 | Staging is awake and the database served the query | continue |
| 401 / 403 | The anon key in `.env.local` is wrong or rotated | 1 |
| 404 (PGRST205) | The `staff` table is missing, so a migration is not applied | 1 |
| 000 | No answer in 20s: network down, or the project is paused | 1 |
| anything else | Unexpected | 1 |

3. After a 200 it runs `check-auth-config.sh`. It requires `disable_signup:
   true`, `mailer_autoconfirm: false` and `external.anonymous_users: false`. A
   wrong setting exits **2**, and a failed check exits **78**.

## rc-keepalive.sh: one Remote Control session

1. If `tmux` or `claude` is not on PATH, exit **78**.
2. If `~/portal-rc` does not exist, exit **78**. It never creates the worktree.
3. If tmux session `suite` exists, exit 0 and do nothing.
4. Otherwise it unsets `ANTHROPIC_API_KEY` and starts `claude --remote-control
   "Power Suite" --name "Power Suite"` detached in `~/portal-rc`.

It never kills a session. Only a person ends one, with `tmux kill-session -t
suite`.

One-time setup, done by a person:

```
brew install tmux
git -C ~/portal worktree add ~/portal-rc -b rc/desk origin/main
./deploy/install.sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/uk.poweranalytix.portal.rc.plist
```

## Where a person is required

- **Merging** every overnight PR. A PR that touches `BLOCKED.md` or `CLAUDE.md`
  is always merged by a person.
- **Applying migrations**, typed by a person: `! supabase db push`.
- **Secrets**: filling in `~/portal/.env.local`, and rotating keys in Vercel and
  the password manager.
- **Supabase project settings**: auth providers, SMTP, templates, redirect URLs,
  and `disable_signup`.
- **DNS and SMTP**: GoDaddy DNS, Resend domain, Microsoft 365, and the
  `portal.poweranalytix.co.uk` cutover.
- **The Mac itself**:
  - re-running `deploy/install.sh` after a merge that touches `deploy/` or
    `overnight.sh`;
  - `bootstrap`/`bootout` of jobs;
  - typing the FileVault password after any restart.

## Known gaps

- **Stacking.** The script computes which tasks open PRs already claim, but the
  skip itself is enforced by the agent obeying the prompt. Nothing in the
  script refuses to start while unmerged `overnight/auto-*` PRs pile up. A
  claim is also missed for a PR that forgot to move its heading.
- **No retry.** A network failure at fetch or push loses the night (exit 78),
  with no back-off and no second attempt.
- **Node version.** `.nvmrc` says 22. The Mac runs Node 26, and nothing selects
  22 before verify.
- **`.tmp` ignore check** is flaky, as described in step 11.
- **Stray branches** are left behind after a fatal exit, as described in step 23.
- **Migrations aren't structurally blocked.** The agent has a shell and skipped
  permissions. A Supabase CLI login in the keychain means `supabase db push` is
  one command away. Only the prompt, `BLOCKED.md` and a keychain prompt stand
  in the way.
- **Restarts.** With FileVault on and no automatic login, a restart brings
  nothing back until someone logs in at the Mac.

# Operations

How each scheduled job on the Mac Studio decides what to do, where a person is
required, and what is known not to be guarded. `deploy/README.md` is how to
install them; this is how they behave once installed. Written from a read of
`overnight.sh` and `deploy/` at `5d10a6b`, 26 September 2026.

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

1. `cd ~/portal`, or **exit 78**.
2. `git`, `node`, `npm`, `gh` and `claude` must be on PATH, or **78**.
   `TASKS.md` and `CLAUDE.md` must exist, or **78**.
3. Take the lock `~/Library/Caches/uk.poweranalytix.portal.overnight.lock`
   (`mkdir`, atomic). If its PID is alive, **exit 66**. If it is dead, reclaim it.
4. `.git/index.lock` exists → **65**. A rebase, merge or cherry-pick is in
   progress → **65**. It never deletes or aborts either.
5. `git status --porcelain` is non-empty → **64**. Untracked files count. Stashes
   are logged but do not stop the run.
6. `git fetch --prune origin`. If that fails (no network, no credential),
   **78**. **There is no retry.**
7. `git checkout main`, or **78**, then `git merge --ff-only origin/main`. If
   they have diverged, **65**.
8. Create `overnight/auto-YYYY-MM-DD-HHMM`. From here on the run owns the
   branch, and the EXIT trap may commit leftovers to it.
9. `node_modules`, `.tmp`, `playwright-report` and `test-results` must each be
   git-ignored, or **78**.
10. With `--dry-run`: ask claude to write and commit `.dry-run-probe`, check the
    commit landed, delete the branch, return to the starting branch, and exit
    **0**. If the probe doesn't commit, **70**.
11. If `package-lock.json` is newer than `node_modules`, or `node_modules` is
    missing, run `npm ci` (15 min limit). If that fails, **78**.
12. **Claimed tasks.** For each open, *non-draft* PR on an `overnight/*` branch,
    list the `###` task titles on `origin/main:TASKS.md` that the branch no
    longer has. Those are "claimed". The script does not remove them from the
    queue itself; it appends an "ALREADY DONE" list to the prompt.
13. **The agent** runs `claude -p --dangerously-skip-permissions` (80 min limit)
    with this prompt:
    - read CLAUDE.md and BLOCKED.md first;
    - take the **first** task under a "Next up" heading that is not in Held, not
      in Done, and not claimed;
    - do only that task;
    - commit on the current branch;
    - it may **not** create or switch a branch, push, open a PR, merge, or apply a
      migration by any route;
    - if the task needs anything in BLOCKED.md, reply `BLOCKED: …`;
    - if "Next up" is empty, reply `QUEUE EMPTY`;
    - leave nothing uncommitted or stashed;
    - finally, move the task to Done with the branch name beside it.

    If the agent fails or times out, **70**.
14. **No new commits.** If files were left behind, the branch is kept and the
    run exits **0**. If the transcript has a `BLOCKED:` line, the run logs it,
    deletes the branch, and exits **0**. Otherwise it is an empty queue: delete
    the branch, exit **0**.
15. **Leftover files after commits.** If anything looks like a secret (the
    filename matches `.env`, `.pem`, `.key`, `token`, `secret`, `credential`
    and similar, or an untracked file contains a JWT, private key, `sk_live_` or
    `re_…`), the run stops with **64** and leaves the tree for a person.
    Otherwise it commits the files as a sweep.
16. `npm run verify` (25 min limit). Its log goes to `~/Library/Logs/PowerAnalytix/`.
17. `git push -u origin <branch>`, whatever verify returned. A failed push is
    **78**; the commits stay on the Mac.
18. **Verify passed:** open a *ready* PR titled `overnight: <date>`. Then close
    any open draft on another `overnight/*` branch that removed the same task
    heading ("superseded"). Check out main and exit **0**.
19. **Verify failed:** open a *draft* PR titled `overnight: <date> — verify FAILED`,
    check out main, and exit **69**.
20. **Clean-up (EXIT trap).** Only if the run made its branch: if still on
    that branch with leftovers that don't look like secrets, commit them. Then
    check out main and release the lock.

**It will never:** push to `main`, merge, close a non-draft PR, apply a
migration from the script, start on a dirty tree, abort someone else's
rebase/merge, delete `.git/index.lock`, or pass any `SUPABASE_*` or
`RESEND_*` variable to the agent.

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

- **Merging** every PR. The runner opens them and never merges them. A PR that
  touches `CLAUDE.md` or `BLOCKED.md` is always merged by a person.
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

- **The guard against stacking is in the prompt, not the script.** The script
  works out which tasks open PRs have claimed, but it only passes that list to
  the agent. Nothing stops an agent that ignores it. Nothing caps the number of
  open `auto-*` branches either, so if merges stall, a PR opens every night.
  Drafts never count as claims.
- **No retry after a network failure.** A failed `git fetch`, push or
  `gh pr create` ends the night (78). The next attempt is 24 hours later.
- **Node.** `.nvmrc` says `22`, but the machine runs Homebrew Node 26
  (`/opt/homebrew/bin/node`), and nothing reads `.nvmrc`. `engines` only asks for
  `>=20.9.0`, so it passes. CI and Vercel may be running a different major.
- **The `.tmp` check fails on a fresh checkout.** `.gitignore` has `.tmp/`, a
  directory-only pattern, and `git check-ignore .tmp` does not match a path that
  doesn't exist yet. On 26 September at 19:07 the first run on this Mac exited
  78 for that reason. It passed three minutes later, once `.tmp/` had been
  created.
- **A run that exits 78 at the ignore check leaves its branch behind.** The EXIT
  trap checks out main but deletes nothing.
  `overnight/auto-2026-09-26-1907` is one of these.
- **The installed copy is what runs.** A merge that changes `deploy/` or
  `overnight.sh` has no effect until `deploy/install.sh` is re-run. Nothing
  detects the drift.
- **Nothing structural stops the agent running `supabase db push`.** See
  `deploy/README.md`. Whether the CLI is logged in decides whether it could.

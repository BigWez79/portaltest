# Operations — how the scheduled jobs decide

What each job on the build Mac does, in the order it does it, and every point
where it stops for a person. Installing them is `deploy/README.md`; the reasons
behind each line are in the scripts and plists themselves. This file is the
flow, written from the code as it stands on `main`, so it can be checked against
the code rather than remembered.

## The jobs

| Job | When (UK time) | Runs | Log |
|---|---|---|---|
| `uk.poweranalytix.portal.overnight` | 03:00 daily | installed `overnight.sh` | `~/Library/Logs/PowerAnalytix/overnight-<date>.log` |
| `uk.poweranalytix.portal.staging-keepalive` | 07:00 daily, and at load | installed `staging-keepalive.sh` → `check-auth-config.sh` | `~/Library/Logs/PowerAnalytix/staging-keepalive.log` |
| `uk.poweranalytix.portal.rc` | at load, then every 10 min | installed `rc-keepalive.sh` | `~/Library/Logs/PowerAnalytix/rc-keepalive.log` |

launchd runs on the Mac's local clock, so these stay at the same UK time across
the clock change. Anything scheduled in the cloud on UTC moves an hour earlier
in UK time when the clocks go back.

## overnight.sh

### Before it does anything

1. **Not from inside the checkout.** If it finds itself running from a file
   inside `~/portal`, it copies itself to `~/Library/Caches/` and re-runs from
   there, because checking out `main` would rewrite the file bash is reading.
2. **Repo present.** `cd ~/portal`, or **exit 78**.
3. **Tools present.** `git`, `node`, `npm`, `gh` and `claude` must all be on
   PATH, or **exit 78**. The plist sets PATH explicitly, because launchd starts
   with almost none.
4. **`TASKS.md` and `CLAUDE.md` present**, or **exit 78**.
5. **One run at a time.** It takes a lock directory in `~/Library/Caches/`. If
   the PID in it is still alive: **exit 66**. If it is dead, the lock is
   reclaimed and the run carries on.
6. **No git operation half-finished.** `.git/index.lock` present, or a rebase,
   merge or cherry-pick in progress: **exit 65**. It does not delete the lock
   or abort the operation. A person does that.
7. **Clean tree.** Any `git status --porcelain` output: **exit 64**. Stashes are
   noted in the log, but they do not stop the run.

### Getting onto a branch

8. `git fetch --prune origin`, or **exit 78** (no network, or no credential for
   origin). There is no retry.
9. Check out `main` and fast-forward it to `origin/main`. If it can't
   fast-forward, main has diverged: **exit 65**.
10. Create `overnight/auto-<YYYY-MM-DD>-<HHMM>` from there. From this point the
    run "owns" the branch, and its exit trap may tidy it.
11. **Ignore check.** `node_modules`, `.tmp`, `playwright-report` and
    `test-results` must each be ignored by `.gitignore`, or **exit 78**.
12. With `--dry-run`, it asks the agent to create and commit one file, checks
    the commit landed, deletes the branch and goes back to where it started:
    **exit 0** if it worked, **exit 70** if not. It never pushes.
13. `npm ci` runs only if `node_modules` is missing or `package-lock.json` is
    newer than it. If it fails: **exit 78**.

### Choosing the task

14. **What is already claimed.** For each open, non-draft pull request on an
    `overnight/*` branch, it compares that branch's `TASKS.md` headings with
    main's. Headings missing from the branch are tasks that pull request has
    done. Numbers are stripped before comparing, because the agent renumbers
    what it leaves behind. Drafts don't claim anything: a draft means verify
    failed, and that task still needs doing.
15. **The prompt.** The agent is told to read `CLAUDE.md` and `BLOCKED.md`
    first, then take the first task under "Next up" that isn't in Held or Done,
    and do that one task only. If step 14 found anything, the prompt also lists
    those tasks as already done and says to skip them.
16. **Eligible** means: under "Next up", not in Held, not in Done, not claimed
    by an open non-draft pull request, and not needing anything in
    `BLOCKED.md`.

### What the agent is told

17. **May:** edit files, write a migration and commit it (and say it is
    waiting on a person), and commit on the branch that is already checked out.
    It finishes by moving the task to Done with the branch name beside it.
18. **May not:** create or switch a branch, push, open a pull request, merge,
    run `supabase db push` or apply a migration any other way, work around
    `BLOCKED.md`, or leave anything uncommitted or stashed.
19. **How it ends without work.** An empty "Next up" gets the reply
    `QUEUE EMPTY`. A task that needs something in `BLOCKED.md` gets
    `BLOCKED: <what it needs>`.
20. It runs as `claude -p --output-format text --dangerously-skip-permissions`
    with an 80-minute limit (`CLAUDE_TIMEOUT`, 4800s). The runner sends TERM,
    then KILL 20 seconds later. A crash or timeout: **exit 70**.

### After the agent

21. **No commits and a clean tree.** If the transcript has a `BLOCKED:` line,
    it logs the blockage, deletes the branch and exits **0**. Otherwise it
    treats the run as an empty queue, deletes the branch and exits **0**.
22. **No commits, but files left behind.** It keeps the branch and exits **0**.
23. **Commits, with files left behind.** If anything left over looks like a
    secret, it stops and leaves the tree as it is: **exit 64**. "Looks like a
    secret" means one of two things:
    - a filename matching `.env`, `.log`, `agent_logs/`, `.pem`, `.p12`,
      `.key`, `id_rsa`, `credential`, `secret` or `token`;
    - an untracked file whose contents contain a private key, a JWT, `sk_live_`
      or a Resend key.

    Otherwise it commits the leftovers as a sweep.
24. **Verify.** `npm run verify`, with a 25-minute limit (`VERIFY_TIMEOUT`,
    1500s).
25. **Push.** It pushes the branch, pass or fail. If the push fails:
    **exit 78**, and the commits stay local only.
26. **Verify passed.** It opens a ready pull request titled
    `overnight: <date>`, then closes any open draft on another `overnight/*`
    branch that did the same task, with a comment. The draft's branch is kept.
    Then it checks out `main`: **exit 0**.
27. **Verify failed.** It opens a **draft** pull request titled
    `overnight: <date> — verify FAILED`, with the last 60 lines of the verify
    log, then checks out `main`: **exit 69**.
28. **On every exit, through the trap.** If the run owns a branch and the tree
    is dirty on that branch, it commits the leftovers, unless they look like a
    secret. It never touches a dirty tree on any other branch. It checks out
    `main` and releases the lock.

### What it will never do

- Push to `main`, merge, or approve its own pull request.
- Apply a migration. The script has no `db push`; the agent is told not to.
- Start on a dirty tree, over a half-finished git operation, or alongside
  another run.
- Delete `.git/index.lock`, or abort someone's rebase.
- Commit a file that looks like a secret.
- Read `.env.local`, or pass any Supabase or Resend variable to the agent.

### Exit codes

| Exit | Meaning |
|---:|---|
| 0 | pull request opened; or queue empty; or blocked (logged as BLOCKED); or dry run passed |
| 64 | tree dirty at start, or a secret-looking file left behind |
| 65 | `index.lock`, a rebase, merge or cherry-pick in progress, or main diverged |
| 66 | another run holds the lock |
| 69 | task done, verify failed: draft pull request |
| 70 | headless run failed or timed out, or the dry-run probe did not commit |
| 78 | a prerequisite is missing: repo, tool, TASKS.md, fetch, ignore rule, `npm ci`, push or `gh pr create` |

## staging-keepalive.sh

1. Read `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `~/portal/.env.local`,
   stripping any surrounding quotes. If the file is unreadable or either
   variable is empty: **exit 78**, and no request is made.
2. `GET <SUPABASE_URL>/rest/v1/staff?select=id&limit=1` with the anon key, and
   a 20-second limit. Under RLS this returns an empty array. It counts as
   database activity, which is what stops a free project pausing.

| HTTP | Meaning | Exit |
|---|---|---:|
| 200 | the database served a real query; staging is awake | continues |
| 401 / 403 | the anon key is wrong or has been rotated | 1 |
| 404 (`PGRST205`) | the `staff` table is missing: a migration hasn't been applied, or the URL points at the wrong project | 1 |
| 000 | no answer in 20s: no network, a wrong host, or the project is paused | 1 |
| anything else | logged with the code | 1 |

3. After a 200, it runs `check-auth-config.sh`. That reads
   `/auth/v1/settings` and requires `disable_signup: true`,
   `mailer_autoconfirm: false` and `anonymous_users: false`. If any is wrong:
   **exit 2**. It reports and never fixes.

It writes nothing, and it never uses the service-role key.

## rc-keepalive.sh

1. No `tmux` on PATH: **exit 78**.
2. tmux session `suite` exists: **exit 0**, silently.
3. `claude` missing, `~/portal-rc` missing, `~/portal-rc` being the build's own
   checkout, or `~/portal-rc` on `main`: **exit 78**.
4. Otherwise it starts `claude --remote-control "Power Suite"` in a detached
   tmux session `suite`, in `~/portal-rc`, logs one line and exits **0**.

Attach with `tmux attach -t suite`, and detach with `C-b d`. Closing a
Terminal window no longer ends the session. The first start needs one attach,
to answer the folder-trust question.

## Where a person is required

| What | Why a machine doesn't do it |
|---|---|
| **Merging** every pull request | The runner never merges its own work. `main` requires the `verify` check. A pull request touching `CLAUDE.md` or `BLOCKED.md` is always merged by a person. |
| **Applying migrations**: `! supabase db push`, typed by the person | `BLOCKED.md` → Data. An instruction in chat doesn't count. The agent may run `--dry-run`. |
| **Secrets**: rotating keys, filling `.env.local`, Vercel env vars | Keys never enter a chat, a commit or an agent's context. |
| **DNS and SMTP**: GoDaddy, Resend domain, Supabase Auth SMTP | Project settings and billing are off limits. |
| **Supabase project settings**: signups, redirect URLs, templates, JWT | `check-auth-config.sh` reports drift; a person fixes it in the dashboard. |
| **Installing or changing a job**: `install.sh`, `launchctl bootstrap` and `bootout` | Installing starts something that commits unattended. |
| **Resolving exits 64, 65 and 66** | They mean something unexpected is in the tree or in git. The runner won't guess. |
| **After a power cut** | With FileVault on, nothing runs until someone types the password at the Mac. |

## Known gaps, stated plainly

- **Stacking unmerged branches is guarded by the prompt, not the script.** The
  script works out which tasks open pull requests have claimed, but all it does
  with that list is put it in the prompt. Nothing afterwards checks that the
  agent didn't redo a claimed task. Draft pull requests claim nothing, by
  design, so a failed night's task will be tried again. That's intended, but
  it can stack.
- **No retry after a network failure.** A failed `git fetch` loses the night
  (exit 78). So does a failed push, with the commits left only on this Mac. The
  keep-alive doesn't retry either: one 000 at 07:00 is one missed day.
- **Node version.** `.nvmrc` says 22. `package.json` allows `>=20.9.0`. The
  runner uses whatever `node` is first on PATH, which on this Mac is Homebrew's
  Node 26. Nothing reads `.nvmrc`, so the nightly build is tested on a
  different major version from the one the repo declares.
- **The ignore check depends on the directory existing.** `.gitignore` has
  `.tmp/` with a trailing slash, and `git check-ignore .tmp` only matches it
  once `.tmp` exists as a directory. On a fresh clone, or once `.tmp` is
  cleaned, step 11 fails with exit 78 even though the rule is right. That is
  what happened at 19:07 on 2026-09-26; the same check passed at 19:10.
- **A fatal exit after step 10 leaves the local branch behind.** The trap
  checks out `main`, but only the dry-run and empty-queue paths delete the
  branch.
- **Exit 70 can leave `main` dirty.** On a headless failure the script checks
  out `main` before exiting. Uncommitted changes carry over to `main`, and the
  trap won't touch a dirty tree on a branch it didn't create, so the next
  night stops at exit 64.
- **Nothing structural stops the agent applying a migration.** It has a shell
  and skipped permissions. If the Supabase CLI is logged in (its token lives
  in the login keychain), `supabase db push` works from inside the run. What
  stops it is the prompt and `BLOCKED.md`. The keychain prompt is a guard only
  when it actually appears.
- **The keep-alive plist's comment is stale.** It still says the script asks
  GoTrue for its health. The script now reads a row, as described above.

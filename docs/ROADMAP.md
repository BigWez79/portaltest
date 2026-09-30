# Power Suite roadmap

Status: DRAFT

> **DRAFT, written by Claude on 30 September 2026 for Wesley to edit.** It was
> put together from the Held section of `TASKS.md`, `BLOCKED.md`,
> `docs/PORTING-APPS.md`, `docs/OPERATIONS.md` and the decisions still open.
> Nothing in it was decided by Wesley yet. While the `Status: DRAFT` line
> above is here, the planner reads none of it. Delete that line once the lists
> are yours.

This is the **only** source of new work for the overnight build. When fewer
than two tasks are eligible, the planner turns up to three items from **Ready
to build** into `### T-n` tasks in `TASKS.md`. Each one says which item it came
from (`Source: ROADMAP — R-n — Title`). The planner may not queue anything that
isn't here, and the merge gate refuses a plan that tries. The machine never
edits this file: it is a protected path, so a change to it always waits for
Wesley.

How to write an item:

- Headed `### R-<n> — Title` under **Ready to build**. The ID is never reused,
  so the planner can tell an item it has already queued from a new one.
- Say what it is and what "done" looks like. The planner turns that into
  checkable criteria; it may not widen it.
- To make one item wait for another's task, write `After R-<n>` in it, and the
  planner will carry that across as `After T-<n>`.
- Anything that needs a decision first goes under **Needs Wesley first**, with
  the decision spelled out. Move it to Ready to build once you've answered it,
  and write the answer into the item.

---

## Ready to build

Nothing here needs a decision from Wesley. Three of the four change the
machinery (`.gitignore`, `deploy/`, `overnight.sh`), which are protected paths:
the build can make them, and the gate will hold each one for you to merge.
Every product item still left needs a decision first — see the next section.

### R-1 — Test output is ignored on a fresh checkout

`.gitignore` has `.tmp/`, `playwright-report/` and `test-results/`. A pattern
ending in `/` only matches a directory that already exists, so on a fresh
clone `git check-ignore -q` fails for all three, and the overnight run stops
with exit 78 before building anything. The Mac Studio gets round this: `.tmp`
is in `.git/info/exclude`, and the other two directories already exist from
earlier runs. No other checkout has either. Source: `docs/OPERATIONS.md`,
Known gaps. The other two were found while testing the loop on 30 September.

Done when a fresh clone, with nothing in `.git/info/exclude`, passes
`git check-ignore -q` for `node_modules`, `.tmp`, `playwright-report` and
`test-results`, and the suite still leaves the tree clean.

Size: S. Touches `.gitignore` (protected).

### R-2 — The merge gate notices a loosened assertion

The gate treats a test as weakened only when it can see it: a deleted test
file, an added `.only`, `.skip` or `.fixme`, or fewer tests passing. A test
changed to expect the wrong value still passes the gate. Source:
`docs/OPERATIONS.md`, Known gaps.

Condition e) also refuses a branch that removes an `expect(` line from a test
file that already exists on main, unless the same line comes back unchanged
elsewhere in that file.

Done when `scripts/test-merge-gate.sh` has a case for a changed expectation,
which is refused by e), and a case for a moved expectation, which isn't.

Size: S. Touches `deploy/merge-gate.sh` and `scripts/` (protected).

### R-3 — One retry for fetch, push and `gh pr create`

Retries cover the agent only. One failed `git fetch`, `git push` or
`gh pr create` ends a task with exit 78 and counts as a failure, so two brief
network blips in a row stop the night. Source: `docs/OPERATIONS.md`, Known
gaps.

Each of the three gets one retry, 60 seconds later, logged as a retry.

Done when a test with a stub `git` or `gh` that fails once, then succeeds,
shows the task going on, and a stub that fails twice still stops it with 78.

Size: S. Touches `overnight.sh` and `scripts/` (protected).

### R-4 — Record which porting questions the ports answered

`docs/PORTING-APPS.md` still lists three open questions: the legacy profile
list, colleague names versus own-records-only, and the two settings lists.
The ports have happened since. Read the migrations and code to see what each
port actually did about each question, and write that into the document. If a
question was never settled, say so plainly rather than settling it.

Done when each of the three questions in `docs/PORTING-APPS.md` has a dated
note saying what was done, with the file that shows it, or "not settled".

Size: S. Documentation only.

---

## Needs Wesley first

The planner never queues these. Each one says what's needed. Once it's done,
move the item (or what follows from it) up to Ready to build.

### W-1 — Margin Split: apply the migration, then merge #53

T-1 is built and green, and the gate holds it for three reasons: it adds
`supabase/migrations/0012_margin_split.sql`, it touches
`src/app/api/test/session/route.ts` (protected), and it's about 1,330 lines,
over the 800 limit.

Do: apply `0012_margin_split.sql` in the Supabase SQL editor, review #53, and
merge it.

### W-2 — Apply migrations 0001–0011 to the Supabase projects

They're written and not applied (BLOCKED.md, Data). Until they are, the ported
apps run only on fixtures. Held since the projects were first created.

### W-3 — Signups off, and Supabase Auth's SMTP pointed at Resend

Supabase project settings (BLOCKED.md). The staging keep-alive checks the
first part every morning, but it doesn't change anything.

### W-4 — The one-off staff import, then deleting the import script

Export the SharePoint Staff list to CSV, check it, and run
`scripts/import-staff.ts` once, against production.

Then: "delete the import script" can move to Ready to build. It goes in the
cutover pull request (TASKS.md, Held).

### W-5 — The domain cutover

Point `portal.poweranalytix.co.uk` at Vercel (BLOCKED.md, Release).

Then: `PRODUCTION_URL` in `overnight.sh` becomes the real domain, so the
nightly smoke test checks what people actually use.

### W-6 — Vercel Deployment Protection, and `SITE_URL`

Why `getUser()` sees nobody on Vercel (TASKS.md, Held). It's very probably the
SSO interstitial, not an app bug.

Decide: whether to turn Deployment Protection off for Production, or wait for
the cutover. Check the value of `SITE_URL` in Vercel Production at the same
time.

### W-7 — Did a second Supabase inactivity warning arrive?

The keep-alive question (TASKS.md, Held). Only you can see the email.

If a second warning did arrive, "make the keep-alive write rather than read"
becomes Ready to build.

### W-8 — Colleague names: a `staff_directory` view?

Under the "own records only" rule, a page can't show a colleague's name. A
view exposing only email, full name and active to any signed-in staff member
would change who can read what, and rule 11 says that needs your decision.

### W-9 — The legacy profile list

Is `legacyProfileListId` still the right source for anyone, or is it read once
and retired? It gets answered from the SharePoint data, not from code. R-4 will
say whether the My Profile port already settled it.

### W-10 — Two things on the live suite (`BigWez79/portal`)

`margin.html` has no sign-in and ships real default figures, and `admin.html`
requests `AllSites.FullControl`. Both are live code in the other repository
(BLOCKED.md, Known). The overnight build works on Power Suite only.

### W-11 — The public repositories

Both are public (BLOCKED.md). Making `BigWez79/portal` private unpublishes
GitHub Pages on a Free plan, so this needs a plan or a hosting decision first.

### W-12 — Which Node

`.nvmrc` says 22, which CI uses. The Mac Studio runs Homebrew Node 26, and
nothing reads `.nvmrc` there. Decide which one is true, and the build can make
the rest agree.

### W-13 — Saved Margin scenarios: stay in the browser, or move to Postgres?

`docs/PORTING-APPS.md` calls this "a separate decision, not part of the port".
Scenarios live in `localStorage` today, so they're per browser and not shared.

### W-14 — Retiring the old pages

The v2.0 portal and each app's old page go a week after the new route has been
live, and never in the same change that ports it (BLOCKED.md, Release). This
depends on W-5.

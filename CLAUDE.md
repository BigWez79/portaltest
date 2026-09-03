# Rules for this repository

Read this every run. Where this file and a chat transcript disagree, this file wins.

## What this is

The Power Analytix suite. One app, one deploy, one sign-in: the portal, the
staff admin screen, and routes for the seven apps behind it — Invoices,
Timesheets, Expenses, Margin & Profit Split, Tax Breakdown, My Profile and
Admin.

All of those except Admin still run as single HTML pages in `BigWez79/portal`,
served by GitHub Pages. Their routes here exist and are guarded, with a
placeholder inside; porting one means replacing that placeholder. Order,
decisions and open questions are in `docs/PORTING-APPS.md`.

It replaces `portal_index.html` v2.0, which held a `Sites.ReadWrite.All` Graph
token in the browser and hid tiles with CSS. There is no Microsoft dependency
left anywhere in this project. Do not add one back.

## Stack

- Next.js App Router, TypeScript, React server components
- Supabase Auth (magic link) for identity, Supabase Postgres for `staff`
- Row level security against the caller's own session — not a service-role read
- Resend for the access-change note; Supabase Auth's SMTP handles sign-in mail
- Playwright + Chromium for the suite
- Vercel for hosting; a merge to `main` is the deploy

## Non-negotiables

1. **No Supabase key reaches a browser** — not the service role, not the anon
   key. Every Supabase call happens on the server. Nothing gets a
   `NEXT_PUBLIC_` prefix, and `npm run check:secrets` fails the build if that
   changes.
2. **The service role is used twice only**: `auth.admin.inviteUserByEmail`, and
   the one-off CSV import. Never to read staff rows for a page — that throws
   away the protection RLS exists to give.
3. **A tile a person may not open is not rendered.** Not hidden, not disabled —
   absent from the DOM. `tests/harness.ts:expectExactlyTiles` asserts this and
   must not be weakened to `toBeHidden()`.
4. **A route 404s for anyone without its flag.** Not 403 — a 403 confirms the
   route exists, which tells somebody what to go looking for.
5. **Every server action re-checks the caller.** A server action is a public
   endpoint; rendering the control is not what stops a non-admin calling it.
6. **The sign-in form answers the same way for any address.** Different
   responses for known and unknown addresses turn it into a staff directory.
7. **`E2E_TEST_MODE` is never set in a deployed environment.** It turns on a
   route that will sign in as anybody. `playwright.config.ts` sets it, and
   nothing else does.
8. **`getUser()`, never `getSession()`.** `getSession` trusts the cookie's
   contents; `getUser` revalidates it against Supabase.
9. **Every route calls `requireApp`.** A layout is not a gate — a nested route
   can be requested directly. One app means one unguarded route exposes whatever
   is behind it.
10. **My Profile has no flag.** Every active staff member gets it, as on the
   live portal. Do not "fix" this by adding a `has_profile` column.
11. **A person reads their own records; an active admin reads everybody's.**
   That is the agreed policy for every table that lands here. Do not widen it
   without a decision.
12. **A check that can pass while the thing it checks is broken is not a check.**
   Three have been found here: `check-auth-config.sh` exists because the suite
   was green while portal-staging had signups enabled; `httpOnly` was missing
   while every test passed; and the keep-alive answered 200 daily for a week
   while the project drifted toward being paused. When you add a check, say what
   would have to be true for it to pass wrongly — and if you can't answer, it
   isn't checking what you think.

## Definition of done

A task is done when there is a commit behind it and `npm run verify` passes:

```
npm run verify      # typecheck -> build -> check:secrets -> test:e2e
```

A claim of DONE with no commit is FAILED. A crash counts as a failure — the
Playwright harness fails any test whose page logged a console error, threw, or
received a 5xx. A test that expects a 404 declares it with
`test.use({ tolerate: ["status of 404"] })` rather than turning the check off.

## Working rules

- Branch `overnight/*` only. Never commit to `main`, never push to `main`.
- Leave nothing uncommitted. Check `git stash list` before reporting done —
  swept-up work never reaches the pull request.
- Anything a tool generates gets added to `.gitignore` **before** it is
  generated. An untracked file makes the tree dirty and aborts the next run.
- Migrations go in `supabase/migrations`, are committed, and are **never
  applied**. A person applies them while watching.
- Acceptance criteria that involve layout must name widths. The suite screenshots
  at 390, 768, 1024 and 1440 and attaches them to the run.
- Tests that write use the fixture store and run `test.describe.serial` after
  `resetStaff(page)`. Suites clean up after themselves or they poison each other.
- Adding an app means: an entry in `src/lib/apps.ts`, a glyph in
  `src/components/TileIcon.tsx`, a route under `src/app` that calls
  `requireApp`, a column in a migration, a `Flag` in `src/lib/staff-admin.ts`, a
  column in `StaffTable`, and cases in `tests/access-matrix.spec.ts` and
  `tests/app-routes.spec.ts`. All of them, or none.

## Layout of the repo

```
src/proxy.ts                    refreshes the session; sends signed-out traffic home
src/lib/guard.ts                requireApp — the gate every app route goes through
src/lib/env.ts                  every environment variable, read lazily
src/lib/supabase/server.ts      request-scoped client (RLS) + the service-role client
src/lib/current-user.ts         "who is this" — the one place that answers it
src/lib/staff.ts                the caller's own row, and access resolution
src/lib/staff-admin.ts          list, set a flag, invite
src/lib/apps.ts                 the seven tiles
src/lib/notify.ts               access-change email; a no-op with no Resend key
src/lib/rate-limit.ts           how often one address, or one IP, may ask for a link
src/lib/rate-limit-store.ts     the same limit, file-backed, for the suite only
src/app/page.tsx                the portal — the tiles
src/app/{invoices,timesheets,expenses,margin,tax-breakdown,profile}/
                                guarded routes, placeholder inside
src/app/admin/page.tsx          staff access
src/app/actions/                server actions — each re-checks the caller
src/app/auth/callback/          where a magic link lands
src/app/api/test/session/       test-mode seeder; 404 in production
src/app/api/test/rate-limit/    reads the sign-in ledger; 404 in production
scripts/import-staff.ts         one-off CSV import; not part of running the app
scripts/check-bundle-secrets.mjs post-build scan of what a browser receives
supabase/migrations/            written by the machine, applied by a person
docs/PORTING-APPS.md            how the other three apps are folded in
tests/                          Playwright; fixture staff data, no live services
```

## Off limits

See `BLOCKED.md`. If a queued task requires anything on that list, stop and say
so in the pull request rather than working around it.

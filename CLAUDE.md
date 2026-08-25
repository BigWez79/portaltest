# Rules for this repository

Read this every run. Where this file and a chat transcript disagree, this file wins.

## What this is

The Power Analytix Suite Portal: sign-in, four tiles, and the screen where staff
access is granted. It is the front door to Invoices, Timesheets and Expenses,
which are separate apps on their own subdomains and are **not** in this
repository — yet. They move onto this identity next; see
`docs/SUITE-IDENTITY.md`.

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
4. **`/admin` 404s for anyone who is not an active admin.** Not 403 — a 403
   confirms the route exists.
5. **Every server action re-checks the caller.** A server action is a public
   endpoint; rendering the control is not what stops a non-admin calling it.
6. **The sign-in form answers the same way for any address.** Different
   responses for known and unknown addresses turn it into a staff directory.
7. **`E2E_TEST_MODE` is never set in a deployed environment.** It turns on a
   route that will sign in as anybody. `playwright.config.ts` sets it, and
   nothing else does.
8. **`getUser()`, never `getSession()`.** The session cookie is shared across
   four subdomains; trusting its contents is not on.

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
- Adding a tile means: an entry in `src/lib/apps.ts`, a glyph in
  `src/components/TileIcon.tsx`, a column in a migration, a `Flag` in
  `src/lib/staff-admin.ts`, a column in `StaffTable`, and a case in
  `tests/access-matrix.spec.ts`. All six, or none.

## Layout of the repo

```
src/middleware.ts               refreshes the session; guards new routes by default
src/lib/env.ts                  every environment variable, read lazily
src/lib/supabase/server.ts      request-scoped client (RLS) + the service-role client
src/lib/current-user.ts         "who is this" — the one place that answers it
src/lib/staff.ts                the caller's own row, and access resolution
src/lib/staff-admin.ts          list, set a flag, invite
src/lib/apps.ts                 the four tiles
src/lib/notify.ts               access-change email; a no-op with no Resend key
src/app/page.tsx                the portal
src/app/admin/page.tsx          staff access
src/app/actions/                server actions — each re-checks the caller
src/app/auth/callback/          where a magic link lands
src/app/api/test/session/       test-mode seeder; 404 in production
scripts/import-staff.ts         one-off CSV import; not part of running the app
scripts/check-bundle-secrets.mjs post-build scan of what a browser receives
supabase/migrations/            written by the machine, applied by a person
docs/SUITE-IDENTITY.md          how the other three apps join this identity
tests/                          Playwright; fixture staff data, no live services
```

## Off limits

See `BLOCKED.md`. If a queued task requires anything on that list, stop and say
so in the pull request rather than working around it.

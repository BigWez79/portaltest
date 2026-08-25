# Rules for this repository

Read this every run. Where this file and a chat transcript disagree, this file wins.

## What this is

The Power Analytix Suite Portal: one sign-in, four tiles, nothing else. It is the
front door to Invoices, Timesheets and Expenses, which are separate apps on their
own subdomains and are **not** in this repository.

It replaces `portal_index.html` v2.0 — a single static file that held a
`Sites.ReadWrite.All` Graph token in the browser. The whole point of the rebuild
is that no token, no Graph scope and no unshown tile reaches a browser again. Do
not reintroduce any of the three.

## Stack

- Next.js App Router, TypeScript, React server components
- Auth.js (`next-auth@5`) against Microsoft Entra ID, pinned to one tenant
- Supabase Postgres for the `staff` table, read server-side with the service role
- Playwright + Chromium for the suite
- Vercel for hosting; a merge to `main` is the deploy

## Non-negotiables

1. **Nothing sensitive gets a `NEXT_PUBLIC_` prefix.** Next.js inlines those into
   the client bundle. `npm run check:secrets` fails the build if it happens.
2. **A tile that a person may not open is not rendered.** Not hidden, not
   disabled — absent from the DOM. `tests/harness.ts:expectExactlyTiles` asserts
   this and must not be weakened to `toBeHidden()`.
3. **The Entra issuer stays pinned to `ENTRA_TENANT_ID`.** Auth.js defaults to
   `/common/`, which lets any Microsoft account on earth begin a sign-in. The
   `signIn` callback also checks the `tid` claim. Keep both.
4. **The portal asks for no Graph scope.** `openid profile email`, nothing more.
   The only Graph permission in the project belongs to `scripts/sync-staff.ts`.
5. **`E2E_TEST_MODE` is never set in a deployed environment.** It turns on a
   route that will sign in as anybody. It is set by `playwright.config.ts` and
   nowhere else.
6. **The sync is one way.** SharePoint is the master while the other three apps
   read it. Nothing in this repo writes to SharePoint.

## Definition of done

A task is done when there is a commit behind it and `npm run verify` passes:

```
npm run verify      # typecheck -> build -> check:secrets -> test:e2e
```

A claim of DONE with no commit is FAILED. A crash counts as a failure — the
Playwright harness fails any test whose page logged a console error, threw, or
received a 5xx.

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
- Adding a tile means: an entry in `src/lib/apps.ts`, a glyph in
  `src/components/TileIcon.tsx`, a column in a migration, a field in the sync
  map, and a case in `tests/access-matrix.spec.ts`. All five, or none.

## Layout of the repo

```
src/auth.ts                     Entra sign-in. Tenant-pinned.
src/lib/env.ts                  every environment variable, read lazily
src/lib/current-user.ts         "who is this" — the one place that answers it
src/lib/staff.ts                staff row lookup + access resolution
src/lib/apps.ts                 the four tiles
src/app/page.tsx                the portal
src/app/api/test/session/       test-mode session seeder; 404 in production
scripts/sync-staff.ts           SharePoint -> Supabase, one way
scripts/check-bundle-secrets.mjs post-build scan of what a browser receives
supabase/migrations/            written by the machine, applied by a person
tests/                          Playwright; fixture staff data, no live services
```

## Off limits

See `BLOCKED.md`. If a queued task requires anything on that list, stop and say
so in the pull request rather than working around it.

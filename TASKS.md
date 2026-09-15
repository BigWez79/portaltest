# Queue

Read top to bottom, one task per run, one commit per task. Move a finished task
to **Done** with the branch name beside it. Anything in **Held** needs a person
and must not be picked up.

Every "done when" here is meant to be checkable by something working alone at
3am. If one is not, it is a bad task — say so in the pull request rather than
guessing. A task that needs a person to judge it belongs in **Held**, not here.

The numbers restart in each section, so "the first task" means the first one
reading top to bottom — ports before hygiene — not the lowest number.

---

## Next up — ports

The agreed plan: all nine apps move off SharePoint, one at a time.
See docs/PORTING-APPS.md for the order and the decisions behind it.

### 1. Port Tax Breakdown
`taxbreakdown.html` in `BigWez79/portal` — note the filename has no hyphen,
unlike the route here. 557 lines. The second of the two calculators and the last
thing in the queue that touches no data.

Read before writing this, so the shape is not guesswork:

- **MSAL is there; Graph is not.** 10 references to MSAL, `msal-browser@3` from
  jsdelivr, a hard-coded `clientId` and `tenantId` in the page — and
  `SCOPES = ["User.Read"]`, zero calls to `graph.microsoft.com`, no lists. It is
  a sign-in gate in front of a calculator, nothing more. This is the one place
  Margin differed: `margin.html` had no authentication at all.
- So step 1 of "What each port involves" is most of the work here: **delete the
  sign-in.** No MSAL, no client id, no tenant id, no redirect handling, no
  Sign out button of its own — `AppShell` has one. The person is signed in or
  they never reached the route. It also takes an Entra app registration id off a
  public page, which is worth having.
- **Nothing to bundle.** The only off-site script is MSAL itself, and it is being
  deleted. Unlike Margin there is no jsPDF equivalent to move to npm.
- **One `localStorage` key**, `paTaxBreakdownInputs_v1`. Keep it, and keep its
  JSON shape, so a browser that has used the live page keeps its figures. Moving
  that to Postgres is a separate decision.
- **Google Fonts are linked.** Sora and Albert Sans are self-hosted here already.

Then follow how Margin came out — written up under "Margin, specifically" in
docs/PORTING-APPS.md. The short version is **the sums first, the markup
second**. The sums are already separable: `corpTax`, `taxSlice`,
`personalAllowance`, `personalTax`, `employerNI`, `mileageClaim` and
`takeHomePct` are pure functions of their arguments and touch no DOM. They move
to `src/lib/tax-model.ts` as they are. `render` and `directorCard` are the
markup and become a client component.

Pin the model with worked examples read off the live page itself, running
headless with every http(s) request aborted — so an example cannot quietly come
from anywhere except the code under test.

**On the figures, this one is not like Margin.** Margin's defaults were real
revenue and a real split, and were replaced with placeholders. What is hard-coded
here is UK statutory rates — corporation tax at 19% and 25%, marginal relief of
3/200, a personal allowance of £12,570 tapering above £100,000. Those are public,
they are the entire point of the calculator, and they must come across **exactly
as they are**. The placeholder rule applies to any default *input* — a salary, a
profit figure, a director's name — and to nothing else. If you cannot tell which
a number is, say so in the pull request rather than changing it.

The route already exists: `src/app/tax-breakdown/page.tsx`, behind
`requireApp("taxBreakdown")`, with a placeholder in it. Porting is replacing the
placeholder. No new entry in `src/lib/apps.ts`, no new flag, no new column, no
migration, nothing waiting on a person.

**Done when** the calculator works at `/tax-breakdown` for somebody with
`has_tax_breakdown` and the route 404s for somebody without it; at least three
worked examples taken from the live page pass against `src/lib/tax-model.ts`;
a test asserts the page makes no off-site request and that the string `msal`
appears nowhere in what is served; the page does not scroll sideways at 390,
768, 1024 or 1440 and those screenshots are attached; and `npm run verify`
passes.

## Next up — Power Suite hygiene

### 1. Accessibility pass on the admin table
The toggles are buttons with `aria-pressed` and a visually hidden label. Check
the table's header association, focus order along a row, and that a screen
reader announces which person a toggle belongs to.

**Done when** an automated axe pass runs against `/` and `/admin` with no
violations at 390 and 1440, and the screenshots are attached.

### 2. Delete the import script at cutover
`scripts/import-staff.ts` is a one-off. Once the staff list is in Supabase and
the admin screen is the way access is granted, the script is a loaded gun: it
overwrites every access flag from a CSV. Remove it — with `scripts/staff-csv.ts`
and `tests/staff-csv.spec.ts`, which exist only to serve it — and its
`import:staff` script, in the pull request that cuts the domain over.

Last, and only after the import has actually run. Do not pick it up before then
— and note it deletes the parser those tests cover, which is the right order
round.

**Done when** the script is gone, `npm run verify` still passes, and README no
longer tells anybody to run it.

### 5. Content-Security-Policy
`next.config.ts` sets `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy` and `Permissions-Policy`, and `tests/hardening.spec.ts`
asserts the first three. Vercel adds `Strict-Transport-Security` on top of
those. The one header nothing sets is `Content-Security-Policy`.

CSP is the one that would have mattered. What this project spent its first month
removing was a `Sites.ReadWrite.All` token sitting in a browser, and the
argument behind every server-side decision since is that a script running on the
page must not be able to reach anything. Nothing enforces that; it is a property
of the code holding, not something checked.

The app is unusually well placed for a strict policy. Fonts are self-hosted,
jsPDF is bundled rather than fetched from cdnjs, and `tests/margin.spec.ts`
already asserts the page makes no off-site request at all. `default-src 'self'`
should be close to reachable.

The hard part is Next's inline scripts. Use a nonce issued from `src/proxy.ts`
rather than leaving `script-src` open — and if a nonce cannot be made to work
with this version of Next under Turbopack, **say so in the pull request with
what you tried**, rather than shipping `'unsafe-inline'` on `script-src`
quietly. A CSP with `'unsafe-inline'` on scripts is the rule 12 shape: a header
that is present, asserted, and not stopping the thing it names.

**HSTS is already there** and this task should not re-add it. Checked against
the deployment on 9 September: Vercel serves
`strict-transport-security: max-age=63072000; includeSubDomains; preload` on its
own, and `content-security-policy` is the only one of the six that is absent.
Setting HSTS in `next.config.ts` as well would be a second source of truth for a
header that is already correct — and a weaker `max-age` there would quietly
override the good one. Leave it to Vercel and say so in the pull request.

If a test asserts HSTS, it has to allow for localhost not sending it, because
localhost is not https. Assert it where it is served or not at all; an assertion
that passes because the header is absent everywhere it is checked is the rule 12
shape again.

**Done when** every response carries a `Content-Security-Policy`;
`tests/hardening.spec.ts` asserts it alongside the four it already checks; no page
in the suite logs a CSP violation — the harness already fails a test whose page
logged a console error, so the suite passing at all is the check; and
`npm run verify` passes.

### 6. Monthly Overview has no tile and no route
docs/PORTING-APPS.md lists nine apps and the portal carries seven. The one
missing is Monthly Overview — 383 lines, four lists, no writes. Every other app
in that table is either ported or "route ready"; this one is "not routed yet",
and has been since the survey on 25 August.

The decision is already recorded — all nine move, agreed 25 August — so this is
the gap between the plan and the repository, not a new question. It is queued
below the calculators because it reads four SharePoint lists and the two
calculators read nothing.

This is the full checklist from CLAUDE.md, all of it or none: an entry in
`src/lib/apps.ts`, a glyph in `src/components/TileIcon.tsx`, a route under
`src/app/overview` calling `requireApp`, a column in a migration, a `Flag` in
`src/lib/staff-admin.ts`, a column in `StaffTable`, and cases in
`tests/access-matrix.spec.ts` and `tests/app-routes.spec.ts`.

Route and tile only. **Do not port the page** — that is its own task, later in
docs/PORTING-APPS.md's order, and it runs into the "staff names versus staff
records" question recorded there, which is not settled. Leave the placeholder in
and say in the pull request that the migration is waiting on a person.

**Done when** the tile appears for somebody with the flag and is absent from the
DOM for somebody without it; `/overview` 404s without the flag; the migration is
committed and unapplied; the access matrix and route tests cover it; the portal
does not scroll sideways at 390 with eight tiles; and `npm run verify` passes.

---

## Held — needs a person

- Creating the Supabase projects and applying `0001_staff.sql` and
  `0002_signin_rate_limit.sql` (BLOCKED.md)
- Turning off email signups and pointing Supabase Auth's SMTP at Resend
- Exporting the SharePoint Staff list to CSV and running the one-off import
- Pointing `portal.poweranalytix.co.uk` at Vercel
- Porting the seven apps (`docs/PORTING-APPS.md`) — agreed in principle, queued
  one at a time. Margin and Tax Breakdown are first and need no data migration.
- Narrowing `admin.html`'s `AllSites.FullControl` on the live suite
- **Saying whether the keep-alive keeps anything alive.** It answered 200 every
  day for a week while portal-staging drifted towards being paused, which is
  where rule 12 came from. It now runs a real query rather than a health check,
  and has answered 200 every morning since 3 September. That is the same
  evidence as before. What was never established is whether Supabase counts a
  `select` as activity at all. Supabase warned on 1 September; if a second
  warning arrives, selects do not count and the next thing to try is a write —
  an insert into `signin_attempts`, which already expires rows out of itself.
  Held because only a person can say whether a warning came. It cannot be
  checked at 3am, and writing that down is better than pretending it can.
- **Why `getUser()` sees nobody on Vercel.** Sign-in works against a local dev
  server and against a local production build, and not on the deployment. The
  logging from PR #10 is on main; reading what it prints needs a redeploy and
  somebody with the Vercel runtime logs open.

---

## Done

- **A 404 and a crash that look like the product** — `overnight/auto-2026-09-15-0300`.
  Rule 4's 404 is not an edge case, it is the answer somebody gets for trying
  `/invoices` to see what happens, and until now it was answered by Next's own
  page: "404 | This page could not be found", system font, no brand. There is now
  `src/app/not-found.tsx`, `src/app/error.tsx` and `src/app/global-error.tsx`,
  the first two sharing one `TroubleCard` so the "not here" screen and the "went
  wrong" screen are indistinguishable — a different card for a route that exists
  would be the 403 this project refused to serve, wearing a hat. Built from the
  sign-in card's own classes, not new ones, because restyling is a person's job;
  the only CSS added centres `.card-note`, which is capped at 56ch for the admin
  screen's prose and reads as a block shoved left inside a centred card.
  `error.tsx` logs the digest and shows nothing else: no stack, no path, no
  digest on the page, and `reset` is deliberately not rendered. `global-error.tsx`
  carries its own `<html>` and inline styles because the layout that imports
  globals.css is the thing that failed — and nothing in the suite can exercise
  it, since a test that shipped a broken root layout to prove the fallback works
  would be its own outage. That one is reviewed by reading it, which is said here
  rather than pretended otherwise.
  `src/app/api/test/crash/` throws so the suite can see `error.tsx` for real —
  under `/api/test` with the seeder and the ledger, so there is one test-mode
  namespace and not two, and 404 outside `E2E_TEST_MODE` like its neighbours. The
  harness grew one change to go with it: `tolerate` now filters the 5xx and
  `pageerror` lines as well as console output, because the test that renders the
  error boundary needs the 500 that put it there. It is matched against the same
  strings that would be reported, so `500 from …/api/test/crash` excuses that one
  request and no other — a 500 from anywhere else in that test still fails it.
  All eight new checks were watched to fail with `not-found.tsx` and `error.tsx`
  taken away.
  **One thing found and not fixed, which the next person should decide on.** The
  rendered 404 names nothing, and that is what the test asserts. The *markup*
  still does: Next streams the requested segment's resolved metadata into the
  flight payload, so the HTML for a 404 on `/invoices` contains the string
  "Invoices — Power Analytix" and the HTML for a 404 on a nonsense path does not.
  The two also differ in length, because an unknown path renders the static
  `/_not-found` and a guarded one renders the error fallback. So a signed-in
  person can still tell a route that exists from one that does not, by reading
  the source rather than the screen. Closing the metadata half means moving every
  guarded route's `metadata` export to a `generateMetadata` that resolves access
  first — which doubles the staff lookup per page load unless `getCurrentUser`
  and `resolveAccess` are wrapped in React's `cache()` first. That is a change to
  the one place that answers "who is this", and not one to make unattended on the
  way past. Closing the length half is a fight with Next that may not be
  winnable. Neither is a leak of who has what, and the tile names are already
  public in `docs/PORTING-APPS.md`; it is a leak of which routes are real.
  No migration; nothing waiting on a person. 142 checks.
- **Renamed the product to Power Suite** — `overnight/auto-2026-09-10-0300`.
  The product is Power Suite; the company is still Power Analytix. The tab now
  reads "Power Suite — Power Analytix", matching the pattern the app routes
  already used, and the line above every heading — the sign-in card, the tiles,
  and the shell each carried their own copy of "Suite Portal" — reads Power
  Suite. `tests/product-name.spec.ts` pins the tab and the heading signed in and
  signed out, at 390 and 1440, reading the rendered text rather than a constant:
  rename either back and it fails. Not only the visible strings — a comment that
  calls the product "the portal" is how a half-rename comes back, so those moved
  too, splitting into "Power Suite" where the product was meant and "the tiles
  page" where `src/app/page.tsx` was. Left alone deliberately: everything that
  names the *old* suite (`BigWez79/portal`, `portal_index.html`, "the live
  portal", "Portal v2.0") is a different thing and still true, and no identifier
  moved — launchd labels, the plists, `PORTAL_*`, `~/portal`, the package name,
  the `Portal` component, the CSS class names. The two email templates in
  `supabase/email-templates/` said "the portal" as well; they are edited here but
  have never been pasted into Supabase (that is blocked on SMTP), so nothing has
  drifted out of step — whoever pastes them gets the new wording. `deploy/` needed
  no change: every "portal" in it is a launchd label, a Supabase project name or a
  path on disk. One thing fixed on the way: the invite check in `admin.spec.ts`
  was waiting the default 5s on a server action doing file I/O, and lost the coin
  flip once on a loaded box — it now waits 15s for the same message, which is a
  slower failure rather than a weaker check. No migration; nothing waiting on a
  person. 134 checks.
- **Deactivating somebody ends their session too** — `overnight/auto-2026-09-05-0300`.
  Deactivation already took their access away on the next page load; what was
  left was the cookie, so they saw a signed-in portal carrying a notice rather
  than the sign-in card. A signed-in request whose staff row says inactive now
  goes to `/auth/sign-out`, which ends the session and returns them to the card.
  A route handler and not the page, because a server component's cookie jar is
  read-only — the page can tell the session should not continue, only a handler
  can clear what makes it continue. Not `auth.admin.signOut(userId, "global")`
  as the task asked: that method takes the *target's* JWT, which an admin does
  not hold, and it would have been a third use of the service role. The same
  revocation happens on the request that carries the session instead —
  `signOut({ scope: "global" })` against the caller's own — which also catches a
  row deactivated by SQL or by the import rather than only by the toggle.
  Guarded routes still 404 rather than redirecting: a redirect would tell a
  deactivated person which routes exist, which is what rule 4 removes. No row at
  all is left alone on purpose — a lookup that failed looks identical from here,
  and signing people out over a failed query is its own outage. The Sign out
  button shares the same `endSession`, which fixed it doing nothing under the
  suite. All three new checks were watched to fail with the redirect taken out.
  No migration; nothing waiting on a person. 130 checks.
- **Showed the audit trail on the admin screen** — `overnight/auto-2026-09-03-0300`.
  `staff_audit` has recorded every change since 0001 and nothing read it; there
  is now a panel per person under the staff table, newest first, saying what
  moved and who moved it. Read through the caller's own session, so the "admins
  read the audit" policy is what returns anything — and `changed_by` is resolved
  to a name from `staff`, read the same way, rather than by adding a foreign key
  and a migration for a join a second small query does. An entry where no flag
  moved is dropped: the sign-in trigger writes `last_seen_at` and that is not a
  decision anybody made. The fixture store grew a matching trail so the suite can
  exercise the panel with no Supabase — one file per person, like the sign-in
  ledger, and cleared by the same reset. No migration; nothing waiting on a
  person. 128 checks.
- **Rate-limited the sign-in form** — `overnight/auto-2026-09-02-0300`. Five
  links per address per minute, twenty per IP per fifteen minutes, counted in
  `signin_attempts` rather than in memory so a redeploy hands nobody a fresh
  allowance. Refusal is silent: over the limit, under it and unknown are all
  told the same thing, so the form still cannot be used to find out who works
  here. Written as a security definer function called with the anon role —
  neither an anonymous write policy nor the service role. `0002` is committed
  and waiting on a person. 122 checks.
- **Portal v3.0 scaffold** — sign-in, tiles, admin screen. First commit.
- **Off Microsoft** — Supabase Auth, RLS, staff admin screen, CSV import.
- **One app** — the apps became guarded routes; shared-cookie machinery
  dropped.
- **Matched the live suite** — surveyed `BigWez79/portal` and found the portal
  had been rebuilt against a six-week-old copy: seven tiles, not four. Added
  Margin, Tax Breakdown and My Profile, two access flags, three routes. 64 checks.
- **Ported Margin & Profit Split** — `overnight/port-margin`. The first app
  folded in. Sums in `src/lib/margin-model.ts`, checked against three worked
  examples read off the live page; jsPDF bundled instead of fetched from cdnjs;
  placeholder defaults. Also fixed a latent race in the fixture store that the
  extra tests brought out. 78 checks.
- **Tested the CSV parser** — `overnight/auto-2026-08-31-0300`. The reading of
  the staff CSV moved to `scripts/staff-csv.ts`, away from the half that talks
  to Supabase, and 41 checks pin the mapping: `Title` → email, what counts as
  Yes, commas inside quotes, duplicates, a row with no address, and the no
  active admin warning. Two quiet failure modes found and closed on the way: the
  BOM Excel writes made the email column go missing, and a flag column absent
  from the export imported everybody with it off without saying so — now a
  warning the dry run prints. Nothing here reaches Supabase or the filesystem.
  Two flakes the longer run brought out were fixed with it: the margin worked
  examples read the calculator before it had restored the seeded state, and the
  test-session helpers now survive one dropped keep-alive socket. 119 checks.

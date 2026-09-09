# Queue

Read top to bottom, one task per run, one commit per task. Move a finished task
to **Done** with the branch name beside it. Anything in **Held** needs a person
and must not be picked up.

Every "done when" here is meant to be checkable by something working alone at
3am. If one is not, it is a bad task — say so in the pull request rather than
guessing.

---

## Next up — ports

The agreed plan: all nine apps move off SharePoint, one at a time.
See docs/PORTING-APPS.md for the order and the decisions behind it.

Nothing queued. Margin was P1 and is done; by the agreed order Tax Breakdown is
next, but nobody has written that task yet and this file is not the place to
invent one. The shape the Margin port came out in is written up under "Margin,
specifically" in docs/PORTING-APPS.md and is worth following.

## Next up — portal hygiene

### 1. Rename the product to Power Suite
The suite is called Power Suite. The company is still Power Analytix. Do it in
one change rather than letting it drift -- half-renamed is worse than either
state, and it is the sort of thing that gets finished in six separate pull
requests over a month otherwise.

Rename in `src/`: the app shell, page metadata and titles, headings, and any
user-visible string that calls the product "the portal". In `tests/`: the
assertions and harness helpers that reference those strings. And in the docs --
`CLAUDE.md`, `README.md`, `docs/PORTING-APPS.md`, `deploy/README.md`.

**Rename no identifier.** The launchd labels `uk.poweranalytix.portal.*`, the
plist filenames, the repository, the Supabase project, the `overnight/*` branch
prefix, the `PORTAL_*` environment variables and `~/portal` on disk all stay
exactly as they are. Renaming any of them breaks jobs that are already
installed, and none of it is anything a person reads.

**Done when** no user-visible string calls the product "the portal"; the page
title and the shell heading read Power Suite; a test asserts the product name in
both at 390 and 1440; `grep -ri "the portal" src tests` returns nothing
user-facing; and `npm run verify` passes.

### 2. Accessibility pass on the admin table
The toggles are buttons with `aria-pressed` and a visually hidden label. Check
the table's header association, focus order along a row, and that a screen
reader announces which person a toggle belongs to.

**Done when** an automated axe pass runs against `/` and `/admin` with no
violations at 390 and 1440, and the screenshots are attached.

### 3. Delete the import script at cutover
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

---

## Done

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

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

### P1. Port Margin & Profit Split
848 lines, no Graph, no SharePoint, no sign-in. The first port, chosen because
nothing is at stake: it is a calculator. The route `/margin` already exists,
guarded by `requireApp("margin")`, with a placeholder inside.

What it involves:

- jsPDF and jspdf-autotable come from a CDN today. Install them from npm and
  bundle them — an overnight build must not depend on cdnjs being up.
- It keeps saved scenarios in `localStorage` under two keys. Leave that as it
  is for now; it is per-browser scratch, not shared data, and moving it to
  Postgres is a separate decision.
- **Replace the default figures.** The live page ships pre-filled with a real
  revenue figure and a real owner split, and that page has no sign-in and sits
  in a public repository. The ported version must use obviously-placeholder
  numbers. This is not optional.
- The ported route is behind sign-in and the `has_margin` flag, which the live
  page is not. That is an improvement, not a regression — do not "fix" it.

**Done when** the calculator produces the same numbers as the live page for
three worked examples, PDF export works from bundled dependencies with no
network at build time, the defaults are placeholders, and `npm run verify`
passes with the route's existing access tests still green.

## Next up — portal hygiene

### 0. Test the CSV parser — before anybody runs the import
`scripts/import-staff.ts` parses CSV by hand and has no test. It runs **once**,
against production, and sets the access flags for every member of staff. Its
failure mode is the quiet one: a mis-parsed column does not crash, it just
grants the wrong people the wrong apps — and `--dry-run` prints counts rather
than rows, so nothing would look wrong.

Pin the mapping: `Title` → email, `Yes` → true, quoted fields containing
commas, duplicate addresses, a row with no address, and a file with no active
admin in it.

This blocks the import, which blocks cutover. It is first for that reason.

**Done when** the parser is covered by tests that run with no Supabase
connection, including the "no active admin" warning, and `npm run verify`
passes.

### 1. Rate-limit the sign-in form
`requestMagicLink` will send a link every time the button is pressed. Supabase
has its own limits, but nothing here stops somebody pasting an address and
holding down enter. Add a per-address and per-IP limit, backed by a table so it
survives a redeploy.

**Done when** a test asks for six links for one address inside a minute and the
sixth is refused with the same neutral message as an unknown address, and the
first five still arrive.

### 2. Show the audit trail on the admin screen
`staff_audit` records every change and nothing reads it. Add a panel per person —
who changed what, and when — reading through the admin RLS policy.

**Done when** an admin flips a flag and sees that change listed against that
person with their own name on it, and a non-admin still gets a 404 for `/admin`.

### 3. Deactivate on the admin screen should end the session too
Worth being precise about what this is and is not. Deactivating somebody already
takes effect on their **next page load**: every route reads the staff row fresh,
so the tiles vanish and `requireApp` 404s. They are not still using the apps.

What is left is that their session cookie stays valid, so they see a signed-in
portal with a no-access notice rather than being signed out. That is untidy, and
on the day somebody leaves badly it is the wrong signal to send. Revoke the
session with `auth.admin.signOut(userId, "global")` when `active` goes false.

This is a tidiness fix, not a hole. Do not let it jump the queue.

**Done when** a test signs somebody in, deactivates them, and their next request
lands on the sign-in card rather than a signed-in portal with a warning.

### 4. Accessibility pass on the admin table
The toggles are buttons with `aria-pressed` and a visually hidden label. Check
the table's header association, focus order along a row, and that a screen
reader announces which person a toggle belongs to.

**Done when** an automated axe pass runs against `/` and `/admin` with no
violations at 390 and 1440, and the screenshots are attached.

### 5. Delete the import script at cutover
`scripts/import-staff.ts` is a one-off. Once the staff list is in Supabase and
the admin screen is the way access is granted, the script is a loaded gun: it
overwrites every access flag from a CSV. Remove it, and its `import:staff`
script, in the pull request that cuts the domain over.

Last, and only after the import has actually run. Do not pick it up before then
— and note it deletes the thing task 0 tests, which is the right order round.

**Done when** the script is gone, `npm run verify` still passes, and README no
longer tells anybody to run it.

---

## Held — needs a person

- Creating the Supabase projects and applying `0001_staff.sql` (BLOCKED.md)
- Turning off email signups and pointing Supabase Auth's SMTP at Resend
- Exporting the SharePoint Staff list to CSV and running the one-off import
- Pointing `portal.poweranalytix.co.uk` at Vercel
- Porting the seven apps (`docs/PORTING-APPS.md`) — agreed in principle, queued
  one at a time. Margin and Tax Breakdown are first and need no data migration.
- Narrowing `admin.html`'s `AllSites.FullControl` on the live suite

---

## Done

- **Portal v3.0 scaffold** — sign-in, tiles, admin screen. First commit.
- **Off Microsoft** — Supabase Auth, RLS, staff admin screen, CSV import.
- **One app** — the apps became guarded routes; shared-cookie machinery
  dropped.
- **Matched the live suite** — surveyed `BigWez79/portal` and found the portal
  had been rebuilt against a six-week-old copy: seven tiles, not four. Added
  Margin, Tax Breakdown and My Profile, two access flags, three routes. 64 checks.

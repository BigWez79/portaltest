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

Last, and only after the import has actually run. Do not pick it up before then.
It takes `scripts/staff-csv.ts` and `tests/import-csv.spec.ts` with it — those
cover the parser precisely so this import can be trusted the one time it runs,
and they have no reason to outlive it.

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
- **Ported Margin & Profit Split** — `overnight/port-margin`. The first app
  folded in. Sums in `src/lib/margin-model.ts`, checked against three worked
  examples read off the live page; jsPDF bundled instead of fetched from cdnjs;
  placeholder defaults. Also fixed a latent race in the fixture store that the
  extra tests brought out. 78 checks.
- **Tested the CSV parser** — `overnight/auto-2026-08-27-0300`. The parsing came
  out of `scripts/import-staff.ts` into `scripts/staff-csv.ts`, which reads no
  file, no environment and no Supabase project, and returns its warnings
  instead of printing them. 41 cases pin the mapping. Two things the tests
  turned up and fixed: a SharePoint BOM hid the `Title` column, and a warning's
  line number drifted after a blank line or a field wrapped over two lines.
  `HasMargin` and `HasTaxBreakdown` still have no mapping — see below. 119 checks.

---

## Noticed, not queued

- **The import has no column for Margin or Tax Breakdown.** `staff` has
  `has_margin` and `has_tax_breakdown`; `scripts/staff-csv.ts` maps neither,
  because nobody has said what the SharePoint list calls them. As it stands the
  import leaves both false and a person grants them on the admin screen, which
  is safe but means the CSV is not the whole picture. Guessing a header name
  here would grant apps to the wrong people quietly, so it is written down
  rather than invented. `tests/import-csv.spec.ts` asserts the gap, so adding a
  mapping fails a test that says why.

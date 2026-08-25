# Queue

Read top to bottom, one task per run, one commit per task. Move a finished task
to **Done** with the branch name beside it. Anything in **Held** needs a person
and must not be picked up.

Every "done when" here is meant to be checkable by something working alone at
3am. If one is not, it is a bad task — say so in the pull request rather than
guessing.

---

## Next up

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
- Porting Invoices, Timesheets and Expenses (`docs/PORTING-APPS.md`) — queued
  per app once its repository has been read

---

## Done

- **Portal v3.0 scaffold** — sign-in, tiles, admin screen. First commit.
- **Off Microsoft** — Supabase Auth, RLS, staff admin screen, CSV import.
- **One app** — the three apps became guarded routes; shared-cookie machinery
  dropped. 51 checks.

# Queue

Read top to bottom, one task per run, one commit per task. Move a finished task
to **Done** with the branch name beside it. Anything in **Held** needs a person
and must not be picked up.

Every "done when" here is meant to be checkable by something working alone at
3am. If one is not, it is a bad task — say so in the pull request rather than
guessing.

---

## Next up

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
Turning `active` off stops the tiles rendering on the next load, but an open
session stays valid until it expires. Revoke it.

**Done when** a test signs somebody in, deactivates them, and their next request
lands on the sign-in card rather than the portal.

### 4. Accessibility pass on the admin table
The toggles are buttons with `aria-pressed` and a visually hidden label. Check
the table's header association, focus order along a row, and that a screen
reader announces which person a toggle belongs to.

**Done when** an automated axe pass runs against `/` and `/admin` with no
violations at 390 and 1440, and the screenshots are attached.

### 5. An import dry-run fixture test
`scripts/import-staff.ts` parses CSV by hand and has no test. Pin the mapping:
`Title` → email, `Yes` → true, quoted fields with commas, duplicate addresses,
a row with no address, and a file with no admin in it.

**Done when** the parser is covered by tests that run without a Supabase
connection, including the "no active admin" warning.

---

## Held — needs a person

- Creating the Supabase projects and applying `0001_staff.sql` (BLOCKED.md)
- Turning off email signups and pointing Supabase Auth's SMTP at Resend
- Exporting the SharePoint Staff list to CSV and running the one-off import
- Pointing `portal.poweranalytix.co.uk` at Vercel
- Migrating Invoices, Timesheets and Expenses (`docs/SUITE-IDENTITY.md`)

---

## Done

- **Portal v3.0 scaffold** — sign-in, tiles, admin screen, 37 checks. First commit.

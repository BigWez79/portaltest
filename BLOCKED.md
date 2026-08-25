# Off limits

A person does these. If a queued task needs one, stop and say so in the pull
request. Do not work around an item on this list, and do not re-queue one.

## Credentials and identity

- **Supabase project settings.** Auth providers, email templates, SMTP, redirect
  URLs, JWT settings. In particular: **email signups stay disabled**. They are
  what stops any address on earth requesting a sign-in link.
- **Rotating any key.** Service role, anon, Resend. They live in Vercel's
  environment and in a password manager. They do not enter a chat, a commit or an
  agent's context.
- **`SESSION_COOKIE_DOMAIN`.** Changing it signs the whole company out, and gets
  the sub-apps' sessions wrong in a way that is hard to see from one browser.

## Data

- **Applying a migration to any Supabase project.** Written and committed
  unattended, applied by a person watching. No exception for "it's only a
  column".
- **Running `scripts/import-staff.ts` against production.** It is a one-off, it
  overwrites access flags for everybody, and it is run once by a person who has
  checked the CSV.
- **Loosening a row level security policy.** Especially: do not add an `anon`
  policy on `staff`, and do not replace the RLS read in `staff.ts` with a
  service-role read to "fix" a query.
- **Deleting a staff row.** People who leave are deactivated, never deleted — the
  row and its audit trail are the only record of what they had.
- **Editing `staff` in the Supabase table editor** in place of the admin screen.
  The screen writes an audit row; the table editor does too, but with no
  `changed_by`. Use the screen.

## Release

- **Merging.** The machine opens pull requests. It never merges and never pushes
  to `main`.
- **The domain cutover.** Moving `portal.poweranalytix.co.uk` to Vercel is one
  way and it is the front door for everyone.
- **Retiring the old static portal.** The v2.0 file is archived on a branch, not
  deleted, and only after the new one has been live for a week.
- **Turning off the Entra registration** the sub-apps still share. It stays until
  Invoices is the last one across — see `docs/SUITE-IDENTITY.md`.

## Product and money

- **Adding, removing or renaming a tile** without a person saying so.
- **Changing who can grant access**, or adding a second place where access is
  granted. One admin screen, or access is not auditable.
- **The look of the page.** Ported from v2.0. Restyling needs live iteration — an
  agent asked to make the portal "more modern" overnight will confidently produce
  something generic and off-brand.
- **Vercel plan, Supabase plan, domains and billing.**

## Currently parked

- **Migrating Invoices, Timesheets or Expenses.** Those are separate
  repositories. The design is written down in `docs/SUITE-IDENTITY.md`; the work
  is not queued here.
- **Anything that reads `graph.microsoft.com`.** There is no Microsoft dependency
  left in this project and it does not come back.

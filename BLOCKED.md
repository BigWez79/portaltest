# Off limits

A person does these. If a queued task needs one, stop and say so in the pull
request. Do not work around an item on this list, and do not re-queue one.

## Credentials and identity

- **The Entra app registrations.** Redirect URIs, client secrets, API
  permissions, consent. An agent that can edit a registration can lock the whole
  company out of the whole suite.
- **Rotating any secret.** `AUTH_SECRET`, the Entra client secret, the Supabase
  service-role key, the sync client secret. They live in Vercel's environment and
  in a password manager. They do not enter a chat, a commit or an agent's
  context.

## Data

- **Applying a migration to any Supabase project.** Migrations are written and
  committed unattended, and applied by a person watching. There is no exception
  for "it's only a column".
- **Any write to the SharePoint Staff list.** The sync reads. While Invoices,
  Timesheets and Expenses still read that list, it is the master and this repo
  does not touch it.
- **Deleting a staff row.** People who leave are deactivated, never deleted — the
  row is the only record of what they had.
- **Bulk edits to production `staff` data.** Access is granted where it is
  granted today.

## Release

- **Merging.** The machine opens pull requests. It never merges and never pushes
  to `main`.
- **The domain cutover.** Moving `portal.poweranalytix.co.uk` to Vercel is one
  way and it is the front door for everyone.
- **Retiring the old static portal.** The v2.0 file is archived on a branch, not
  deleted, and only after the new one has been live for a week.

## Product and money

- **Adding, removing or renaming a tile** without a person saying so. The four
  apps are the four apps.
- **Anything that changes what a staff member can reach.** Access rules are a
  decision, not a task.
- **The look of the page.** Ported from v2.0 as it is. Restyling needs live
  iteration — an agent asked to make the portal "more modern" overnight will
  confidently produce something generic and off-brand.
- **Vercel plan, domains and billing.**

## Currently parked

- **Supabase as the master for staff access.** Blocked until Invoices,
  Timesheets and Expenses stop reading the SharePoint list. Until then the sync
  direction is fixed.
- **Admin app.** The Admin tile points at `/admin`, which is not built in this
  repo yet. Do not scaffold it without a task that says to.

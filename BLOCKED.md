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
- **Anything that widens the session cookie beyond this host.** One deployment
  means a host-only cookie. Do not reintroduce a cross-origin session.

## Data

- **Applying a migration to any Supabase project.** Written and committed
  unattended, applied by a person watching. No exception for "it's only a
  column", and none for staging.

  "Applied by a person" means a person types the command. In Claude Code that is
  the `!` prefix — `! supabase db push` — run inside the session under their own
  hand, with the output landing in front of both of you. The agent does not run
  it.

  **An instruction in chat does not satisfy this.** "Go ahead and push it" is not
  a person applying a migration, it is a person asking an agent to — which is the
  thing this rule exists to stop. The answer to it is the command to paste, not
  the command run. To change that, change this file: the transcript does not get
  a vote, and CLAUDE.md says as much.

  `supabase db push --dry-run` applies nothing and reads only the migration
  history. The agent may run that, and it is the useful thing to offer instead.
- **Running `scripts/import-staff.ts` against production.** It is a one-off, it
  overwrites access flags for everybody, and it is run once by a person who has
  checked the CSV. The script is deleted in the same pull request that cuts over,
  so it cannot be run a second time by accident.
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
- **Turning off an old app's subdomain**, or the Entra registration the three
  still share. Each goes a week after its route has been live — never in the same
  change that ports it. See `docs/PORTING-APPS.md`.

## Product and money

- **Adding, removing or renaming a tile** without a person saying so.
- **Changing who can grant access**, or adding a second place where access is
  granted. One admin screen, or access is not auditable.
- **The look of the page.** Ported from v2.0. Restyling needs live iteration — an
  agent asked to make the portal "more modern" overnight will confidently produce
  something generic and off-brand.
- **Vercel plan, Supabase plan, domains and billing.**

## Known, and deliberately not fixed yet

- **Both GitHub repositories are public.** `BigWez79/portal` (the live suite)
  and `BigWez79/portaltest` (this one). Verified 25 August. No credentials are
  exposed in either — checked for client secrets, API keys, bearer tokens and
  JWT-shaped strings — but assume anything committed here is world-readable,
  because it is.
- **Do not make `BigWez79/portal` private.** GitHub Pages is unpublished
  automatically when a repository goes private on a Free plan, which takes the
  whole live suite offline. The DNS would also need updating first to avoid a
  domain takeover of `portal.poweranalytix.co.uk`. A person decides this, and
  it needs a paid plan or a hosting move.
- **`margin.html` on the live suite has no sign-in at all** and ships real
  default figures. Replacing those with placeholders is a person's call on the
  live page; the ported route must use placeholders regardless (see TASKS.md P1).
- **`admin.html` requests `AllSites.FullControl`.** Narrowing it is a
  one-line change to a page being replaced anyway, but it touches live code.

## Currently parked

- **Porting Invoices, Timesheets or Expenses.** The routes and the gate exist;
  the apps' own code has not arrived yet. The shape is written down in
  `docs/PORTING-APPS.md`, and each port is queued only once its repository has
  been read.
- **Moving an app's records into Postgres.** Whichever of the three keep their
  data in SharePoint lists, that migration is a decision about who may read whose
  records — not a task.
- **Anything that reads `graph.microsoft.com`.** There is no Microsoft dependency
  left in this project and it does not come back.

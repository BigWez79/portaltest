# Power Analytix Suite Portal

One sign-in for the whole suite. Replaces `portal_index.html` v2.0.

The agent-facing rules are in [`CLAUDE.md`](./CLAUDE.md); what needs a person is
in [`BLOCKED.md`](./BLOCKED.md); the queue is [`TASKS.md`](./TASKS.md).

## Running it

```bash
npm ci
cp .env.example .env.local     # fill it in — see below
npm run dev
```

## Verifying it

```bash
npm run verify    # typecheck -> build -> check:secrets -> test:e2e
```

The Playwright suite needs no credentials and reaches no live service. It runs a
production build with `E2E_TEST_MODE=1` and `STAFF_SOURCE=fixture`, reading staff
rows from `tests/fixtures/staff.json` and planting sessions through
`/api/test/session` — which returns 404 in every other environment.

On a machine where `npx playwright install chromium` cannot run, point the suite
at an existing browser:

```bash
E2E_CHROMIUM_PATH=/path/to/chrome E2E_NO_SANDBOX=1 npx playwright test
```

## Setup a person has to do once

Both of these are on the blocked list; they are written down here so the sequence
is not guesswork.

**1. A new Entra app registration** — separate from the SPA registration that
Timesheets and Expenses share. That one is a public client and must not be given
a secret.

- Platform: **Web**
- Redirect URI: `https://portal.poweranalytix.co.uk/api/auth/callback/microsoft-entra-id`
- API permissions: `openid`, `profile`, `email`. **No Graph scopes.**
- Supported account types: **this organizational directory only**
- Create a client secret; put the *value* in `AUTH_MICROSOFT_ENTRA_ID_SECRET`

Entra does not accept wildcard redirect URIs, so Vercel preview deployments
cannot complete a real Microsoft sign-in. Previews use the test-mode seeder;
real sign-in is verified once, on a fixed staging URL, before cutover.

**2. Supabase** — one project for production and one for staging. Apply
`supabase/migrations/0001_staff.sql` by hand:

```bash
supabase link --project-ref <ref>
supabase db push          # a person runs this, watching
```

The `staff` table has RLS enabled and **no policies**. That is deliberate: sign-in
is Entra, not Supabase Auth, so there is no Supabase JWT to write a policy
against. Deny-by-default plus a service-role read from the server is the honest
version. Do not add an anon policy.

## Environment

Every variable is documented in [`.env.example`](./.env.example). One rule worth
repeating: nothing here is prefixed `NEXT_PUBLIC_`, because Next.js inlines those
into the client bundle and one of them is a service-role key. `npm run
check:secrets` reads the built output and fails if that ever changes.

## Where the staff data comes from

SharePoint remains the master while Invoices, Timesheets and Expenses read it.
`scripts/sync-staff.ts` copies it into Supabase one way, on a schedule:

```bash
npm run sync:staff -- --check   # report differences, write nothing, exit 1 if any
npm run sync:staff              # apply
```

Access is still granted where it is granted today — in the SharePoint list. The
portal just stops reading it from inside a browser.

## What changed from v2.0

| | v2.0 | v3.0 |
|---|---|---|
| Sign-in | MSAL in the browser | Auth.js, confidential client, httpOnly cookie |
| Graph scope | `Sites.ReadWrite.All`, in the browser | none |
| Staff lookup | browser reads ~500 SharePoint rows | server reads one Supabase row |
| Tiles you cannot open | in the HTML, hidden with CSS | not rendered |
| Tests | none | 24 Playwright checks at four widths |
| Release | edit the file, upload it | merge to `main` |

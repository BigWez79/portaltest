# Power Analytix Suite Portal

One app for the whole suite: sign-in, the four apps, and the screen where staff
access is granted. Replaces `portal_index.html` v2.0. No Microsoft dependency.

Invoices, Timesheets and Expenses have guarded routes here with a placeholder
inside; they still run as their own deployments until each is folded in.

The agent-facing rules are in [`CLAUDE.md`](./CLAUDE.md); what needs a person is
in [`BLOCKED.md`](./BLOCKED.md); the queue is [`TASKS.md`](./TASKS.md); how the
other three apps get folded in is in
[`docs/PORTING-APPS.md`](./docs/PORTING-APPS.md).

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

The Playwright suite needs no credentials, sends no email and reaches no Supabase
project. It runs a production build with `E2E_TEST_MODE=1` and
`STAFF_SOURCE=fixture`, reading staff from `tests/fixtures/staff.json` and
planting sessions through `/api/test/session` — which returns 404 in every other
environment.

On a machine where `npx playwright install chromium` cannot run:

```bash
E2E_CHROMIUM_PATH=/path/to/chrome E2E_NO_SANDBOX=1 npx playwright test
```

## How sign-in works

1. Somebody types their work email and asks for a link.
2. Supabase sends it, through whatever SMTP the project is configured with
   (Resend). `shouldCreateUser` is false and email signups are off, so an address
   that is not on the staff list gets nothing — and is told the same thing as one
   that is, because different answers make the form a staff directory.
3. The link lands on `/auth/callback`, which exchanges the token for a session
   **on the server**. No Supabase key of any kind is ever sent to a browser.
4. The session cookie is host-only. There is one deployment, so one sign-in
   covers every route and there is no cross-origin session to get wrong.

Supabase accepts wildcard redirect URLs, so every Vercel preview can complete a
real sign-in — which the Entra version could not.

## Setup a person has to do once

All of this is on the blocked list; it is written down here so the sequence is
not guesswork.

**1. Two Supabase projects** — production and staging. In each:

```bash
supabase link --project-ref <ref>
supabase db push          # a person runs this, watching
```

Then, in the dashboard:

- **Authentication → Providers → Email**: enable, and turn **"Enable email
  signups" off**. This is what stops anybody requesting a link.
- **Authentication → SMTP**: point it at Resend, so sign-in and invitation mail
  comes from your domain rather than Supabase's shared sender.
- **Authentication → URL configuration**: site URL
  `https://portal.poweranalytix.co.uk`, and add the Vercel preview wildcard to
  additional redirect URLs.

**2. Import the staff list, once.** Export the SharePoint Staff list to CSV in
the browser, then:

```bash
npm run import:staff -- staff.csv --dry-run   # read it back, change nothing
npm run import:staff -- staff.csv
```

It sends no invitations. Check the list on the admin screen first, then invite
people from there when you are ready for them to arrive. Make sure
`BOOTSTRAP_ADMINS` is set before you rely on this — it is the way back in if the
import lands with no admin.

**3. Vercel** — set the environment variables from `.env.example`, then point DNS
at it.

## Security posture

`staff` has row level security on with real policies, because Supabase Auth means
there is finally a JWT to write policies against:

| Who | Can |
|---|---|
| anyone signed in | read their own row |
| an active admin | read every row, add a person, change flags |
| anyone | delete — **nobody**, there is no delete policy |

The application reads staff with the caller's own session, so Postgres decides
what comes back rather than this codebase remembering to filter. The service role
is used twice: to invite somebody, and by the one-off CSV import.

## What changed from v2.0

| | v2.0 | v3.0 |
|---|---|---|
| Shape | a launcher linking to three subdomains | one app; the apps are routes |
| Sign-in | MSAL in the browser | Supabase magic link, exchanged server-side |
| Graph scope | `Sites.ReadWrite.All`, in the browser | no Microsoft at all |
| Staff lookup | browser reads the whole SharePoint list | server reads one row, through RLS |
| Access admin | a SharePoint list | the Admin tile, with an audit trail |
| Tiles you cannot open | in the HTML, hidden with CSS | not rendered |
| Preview sign-in | impossible (no wildcard redirect URIs) | works |
| Tests | none | 51 Playwright checks at four widths |
| Release | edit the file, upload it | merge to `main` |

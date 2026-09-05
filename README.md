# Power Analytix Suite Portal

One app for the whole suite: sign-in, the four apps, and the screen where staff
access is granted. Replaces `portal_index.html` v2.0. No Microsoft dependency.

Seven tiles: Invoices, Timesheets, Expenses, Margin & Profit Split, Tax
Breakdown, My Profile and Admin. All but Admin still run as single HTML pages in
`BigWez79/portal` and have guarded placeholder routes here until each is folded
in.

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
2. The request is counted first: five links per address per minute, twenty per
   IP per fifteen minutes, in `signin_attempts` rather than in memory, so a
   redeploy does not hand anybody a fresh allowance. Over the limit, no link is
   sent and the answer is the one everybody else gets.
3. Supabase sends it, through whatever SMTP the project is configured with
   (Resend). `shouldCreateUser` is false and email signups are off, so an address
   that is not on the staff list gets nothing — and is told the same thing as one
   that is, because different answers make the form a staff directory.
4. The link lands on `/auth/callback`, which exchanges the token for a session
   **on the server**. No Supabase key of any kind is ever sent to a browser.
5. The session cookie is host-only. There is one deployment, so one sign-in
   covers every route and there is no cross-origin session to get wrong.

## How sign-out works

Two ways in, one way out — `endSession` in `src/lib/session.ts`, which signs the
caller out of every session they hold and clears the cookies that carried it.

- The **Sign out button** is a server action and calls it directly.
- **Being deactivated** ends the session too, on the deactivated person's next
  request. Their access had already gone — every route reads the staff row
  fresh — but the cookie stayed valid, so they saw a signed-in portal with a
  notice in it rather than the sign-in card. The portal now sends them to
  `/auth/sign-out`, because a server component can work out that a session
  should not continue but only a route handler can clear the cookie that makes
  it continue.

Not from the admin screen, and not with the service role: `auth.admin.signOut`
takes the *target's* JWT, which an admin does not have. Doing it on the request
that carries the session gets the same revocation from the caller's own
session — and catches a row deactivated by SQL or by the CSV import, not only
one deactivated with the toggle.

A guarded route still 404s for a deactivated person rather than redirecting
them. Redirecting would tell them that route exists while a made-up path does
not, which is the distinction the 404 rule is there to remove.

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

The dry run prints the counts and, under "Check these", every line it could not
read: a row with no address, a duplicate, a column it could not find. Read that
list before the second command — the mapping itself is pinned by
`tests/staff-csv.spec.ts`, but only the counts can tell you the export is the one
you meant.

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

`staff_audit` is written by a trigger on `staff`, stamped with `auth.uid()`, and
readable only by an active admin — which is what the trail on the admin screen
reads. Nothing grants an insert, so the only way a row appears is a real change.

`signin_attempts` is tighter still: RLS on with no policy at all, and table
privileges revoked from `anon` and `authenticated`. The only way in is
`consume_signin_attempt`, a security definer function the sign-in form calls —
so rate limiting needs neither an anonymous write policy nor the service role.

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
| Tests | none | 64 Playwright checks at four widths |
| Release | edit the file, upload it | merge to `main` |

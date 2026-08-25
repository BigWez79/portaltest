# One sign-in for four apps

How Invoices, Timesheets and Expenses move off Microsoft and onto the same
identity as the portal. Written for whoever picks up each of those three
repositories — the portal is already done and is the worked example.

## The idea in one line

All four apps share one Supabase project and one session cookie set on
`.poweranalytix.co.uk`, so a person who signs into any of them is signed into all
of them, and `staff` is the single answer to "may they open this".

## Why a cookie and not a token

Supabase's session lives in cookies. Set the cookie's domain to
`.poweranalytix.co.uk` and every subdomain sends it: the portal writes the
session at sign-in and `invoices.poweranalytix.co.uk` reads it on the next
request with no redirect, no token exchange and nothing in the URL.

That is the whole mechanism. It only works if every app agrees on three things:

1. **The same Supabase project.** Same `SUPABASE_URL`, same `SUPABASE_ANON_KEY`.
   A second project means a second set of users and the shared cookie is
   meaningless.
2. **The same cookie domain.** `SESSION_COOKIE_DOMAIN=.poweranalytix.co.uk` in
   every app, in every deployed environment. Leave it unset locally, where the
   cookie should stay host-only.
3. **The same cookie name prefix**, which is Supabase's default and derived from
   the project ref — so agreeing on the project settles this too.

## What each app has to do

Copy four files out of the portal. They are deliberately small and have no
portal-specific logic in them.

| From the portal | What it does |
|---|---|
| `src/lib/supabase/server.ts` | request-scoped client, anon key, shared cookie domain |
| `src/middleware.ts` | refreshes the session, sends signed-out traffic to the portal |
| `src/lib/current-user.ts` | the one place that answers "who is this" |
| `src/lib/staff.ts` | reads the caller's own staff row, resolves access |

Then, in the app itself:

- Gate the app on its own flag. Invoices checks `access.apps.invoices`, and so
  on. A person who reaches the app without the flag gets the same 404 the portal
  gives a non-admin who asks for `/admin` — not a 403, which confirms the app
  exists.
- Send signed-out traffic to `https://portal.poweranalytix.co.uk/?next=<url>`
  rather than building a second sign-in form. There should be exactly one place
  in the estate that sends a magic link.
- Delete the MSAL script tag, the client id, the tenant id and every Graph call.
  Nothing should be left that talks to `graph.microsoft.com`.

## Order of work

The apps are not equal in risk, so they do not move in an arbitrary order.

1. **Portal** — done. It owns sign-in, so it has to be first.
2. **Timesheets** — the simplest of the three and the one most people use daily,
   so it surfaces cookie and session problems fastest with the least at stake.
3. **Expenses** — similar shape to Timesheets; do it once Timesheets has been
   live for a week.
4. **Invoices** — last. It touches customer-facing documents, so it moves once
   the pattern has stopped producing surprises.

Until an app has moved, it keeps its Microsoft sign-in and people sign in twice.
That seam is the known cost of not doing all four at once, and it closes on the
day Invoices lands.

## The two things that will bite

**The cookie domain has to be set before the first person signs in on the new
app.** A session written host-only on `portal.poweranalytix.co.uk` is invisible
to `invoices.poweranalytix.co.uk`, and the symptom is "it works for me" from
whoever set it up and "it keeps asking me to sign in" from everybody else.

**`getUser()`, not `getSession()`.** `getSession` trusts the cookie's contents;
`getUser` revalidates against Supabase. On a shared-domain cookie read by four
apps, the difference is whether a forged cookie is worth trying.

## What does not move

`staff` stays owned by the portal. The other three apps read their own row
through RLS and never write to it. Granting access stays in one place — the
portal's admin screen — because access spread across four admin screens is
access nobody can audit.

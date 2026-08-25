# Folding the three apps in

Invoices, Timesheets and Expenses become routes in this repository. This is the
shape they land in, and the order they arrive.

## Why one app rather than four

Four deployments sharing a session means four repositories, four test suites,
four sets of environment variables, and a cookie scoped across origins that has
to be right in all of them before anybody signs in. One app has none of that: a
person is signed in or they is not, `requireApp` says which routes they may open,
and the switcher is a list of links.

The cost is real and worth saying out loud: **a bad deploy takes all four down
together.** That is what the test suite is for, and why every route is covered by
the access matrix. Nothing merges on a red build.

## The shape each app lands in

Each app is already a route, guarded, with a placeholder inside it:

```
src/app/invoices/page.tsx     requireApp("invoices")  -> <PortedAppNotice/>
src/app/timesheets/page.tsx   requireApp("timesheet") -> <PortedAppNotice/>
src/app/expenses/page.tsx     requireApp("expenses")  -> <PortedAppNotice/>
```

Porting one means replacing `<PortedAppNotice/>` with that app's screens. The
gate, the shell, the switcher and the tests around them already work — they were
built and proved before any of the app code arrived, so a port cannot
accidentally ship an unguarded route.

Nested routes go under the same folder (`src/app/invoices/[id]/page.tsx`) and
call `requireApp("invoices")` themselves. **Every route calls the guard.** A
parent layout is not a gate — a nested route can be requested directly.

## What each port actually involves

Roughly in order of effort:

1. **Delete the sign-in.** No MSAL, no client id, no tenant id, no redirect
   handling. The person is already signed in or they never reached the route.
2. **Delete the access check.** `requireApp` did it.
3. **Move the data.** This is the large one. If the app stores its records in
   SharePoint lists — the way the portal stored staff — those become Postgres
   tables with row level security, a migration, and a one-off import. Expect this
   to be most of the work for each app, and to need decisions about who may read
   whose records.
4. **Move the screens.** Markup and styles come across largely as they are; they
   already share a design with the portal.
5. **Server actions for anything that writes**, each re-checking the caller.
   Rendering a control is not a check.

## Order, and why

1. **Timesheets** — the simplest, and the one most people open daily. It proves
   the pattern with the least at stake.
2. **Expenses** — same shape. Move it once Timesheets has been live a week.
3. **Invoices** — last, because it touches customer-facing documents. It goes
   when the approach has stopped producing surprises.

Until an app is ported, its route shows the placeholder and the old app keeps
running on its own subdomain. People who need it go there directly. That is the
seam, and it closes one app at a time.

## Retiring the old deployments

An app's old subdomain is turned off by a person, after the ported route has been
live for a week — not in the same change that ports it. The Entra registration
those apps share goes at the same time as the last one.

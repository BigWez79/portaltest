# Queue

Read top to bottom, one task per run, one commit per task. Move a finished task
to **Done** with the branch name beside it. Anything in **Held** needs a person
and must not be picked up.

Every "done when" here is meant to be checkable by something working alone at
3am. If one is not, it is a bad task — say so in the pull request rather than
guessing. A task that needs a person to judge it belongs in **Held**, not here.

The numbers restart in each section, so "the first task" means the first one
reading top to bottom — ports before hygiene — not the lowest number.

---

## Next up — ports

The agreed plan: all nine apps move off SharePoint, one at a time.
See docs/PORTING-APPS.md for the order and the decisions behind it.

Nothing is queued here at the moment. My Profile is next in the order, and it
is queued once the legacy-profile question in `docs/PORTING-APPS.md` has been
read from the data rather than guessed at. Invoices, Timesheets and Expenses are
parked in BLOCKED.md until their repositories have been read.

## Next up — functionality the port dropped

Read against the twelve original pages in `BigWez79/portal`, copies supplied
2026-09-23, control by control. Each port kept the data and the rules and lost
the documents: to the person using these screens the original *is* a way of
producing a PDF, and that is the part that did not come across.

Forty-one changes, grouped below into tasks that are each one run's work. The
grouping is the unit; the checklist inside each is what "done" means.

Build in the order written. It is not arbitrary — the toolkit is first because
five documents need it, and the invoice document is before the invoice's
filters because the document is what somebody is actually missing.

### 1. The invoice document
`4c00479c-invoices.html:477` builds a full A4 invoice and the port renders
none of it. This is the single biggest thing missing from the suite.

- [ ] Header: logo, business name, tagline
- [ ] Title reads `VAT INVOICE` when the seller is VAT registered, else `INVOICE`
- [ ] Invoice number and a status badge
- [ ] `From` block — the seller, from My Profile
- [ ] `Bill To` block — the customer
- [ ] `Details` block — invoice no., invoice date, due by
- [ ] `Invoice for:` the project line
- [ ] Items table — Item #, Description, Qty, Unit price, VAT, Amount
- [ ] `Payment Details` — payee, sort code, account no., reference
- [ ] The payment-terms sentence, naming the number of days
- [ ] Totals — subtotal net, VAT at the rate, Total Due
- [ ] Baseline — "Thank you for your business" and the VAT registration number
- [ ] A `Print / Save PDF` button and an `@media print` stylesheet

**Done when** an invoice with two lines renders every block above, a test
asserts the document contains the seller's bank details and the customer's
address, and printing is exercised at 390 and 1440 with screenshots attached.

### 2. What an invoice is worth knowing about
The port has Draft, Sent and Paid and stops there. The original derives more.

- [ ] `dueDateOf` — invoice date plus the seller's payment terms
- [ ] `effStatus` — Paid stays Paid; anything not Draft, past its due date, is
      **Overdue**. Overdue is computed, never stored, so it is right tomorrow
      without anything having run overnight.
- [ ] Badge colours: Draft grey, Sent blue, Paid green, Overdue red
- [ ] Filters: All / Outstanding / Due in 7 days / Overdue / Paid

**Done when** an invoice dated past its terms and marked Sent shows as Overdue
with no write having happened, each filter returns the right set against a
fixture with one invoice in each state, and `npm run verify` passes.

### 3. Correcting an invoice, and the number on it
Raised is not final. The original lets a header be corrected and an invoice
deleted, and it numbers them properly.

- [ ] Edit an invoice's header after it is raised
- [ ] Delete an invoice
- [ ] `PREFIX-0000001` — the issuer prefix from My Profile, seven digits, the
      sequence being the highest already used for that prefix plus one
- [ ] The "next number" hint on the new-invoice form
- [ ] Customer address lines 1 and 2 — the port has town and postcode only, so
      an invoice cannot print a full address
- [ ] Edit and delete a customer

**Done when** the next number after `PA-0000009` is `PA-0000010`, a corrected
invoice keeps its number, a full address reaches the document, and
`npm run verify` passes.

### 4. The expenses claim
`f303a141-expenses.html` has `Download claim (PDF)` and the port has nothing.

- [ ] Title `EXPENSES CLAIM`, logo, claim month, generated date
- [ ] The person's name and email
- [ ] Mileage table — Date, Route, Miles, Amount
- [ ] Everything else — Date, Type, Description, Receipt, Amount
- [ ] Mileage subtotal, other subtotal, and `Total to claim (GBP)`
- [ ] The declaration: "I confirm these expenses were incurred wholly and
      necessarily for business."

**Done when** a month holding one mileage claim and one receipted claim
produces both tables, both subtotals and a total equal to their sum, and
`npm run verify` passes.

### 5. Expenses — the two screens, and an admin's copy
The original keeps `My entries` and `Monthly claim` apart; the port merged
them, which is why a month's claim is hard to see.

- [ ] Split `My entries` from `Monthly claim`
- [ ] Admin: `Download their claim (PDF)`, with a person picker and a month
      picker

**Done when** the two views are separate, an admin can produce somebody else's
claim, a non-admin calling that action is refused (rule 5), and
`npm run verify` passes.

### 6. Timesheets — a day is the unit
The port is not a thinner version of the original, it is a different model, and
this is the task that fixes that. Today a day with three activities takes three
actions to correct and the shape of the day cannot be changed at all.

- [ ] `+ Add activity` — build a day up from several rows before submitting
- [ ] `Submit day` — the whole day at once
- [ ] `Edit day` — loads every activity for that date back into the form
- [ ] `Delete day`
- [ ] Annual Leave and Sick are full days: eight hours, and the hours box locks
- [ ] Refuse a second submission for a date already logged, naming the date and
      pointing at `My entries`

**Done when** a three-activity day is submitted once, edited as a unit, and
deleted as a unit; a full-day type locks the hours at 8; a duplicate date is
refused; and `npm run verify` passes.

### 7. Timesheets — the day rate and the period
- [ ] A day rate on the profile, with `Save day rate`
- [ ] A `Month` / `Financial year` switch, the financial year starting 6 April
- [ ] The button label follows the period: `Invoice` for a month, `Statement`
      for a year

**Done when** the switch changes the range and the label, the rate persists,
and `npm run verify` passes.

### 8. Timesheets — three documents
`1b38c30f-timesheet.html` produces three, at lines 1278, 1399 and 1581.

- [ ] `Timesheet_<name>_<period>.pdf` — the full record
- [ ] `Invoice_<name>_<period>.pdf`, and `Invoice_DRAFT_` before it is issued
- [ ] `Statement_<name>_<period>.pdf` — the annual statement

**Done when** all three come out for a period holding billable and non-billable
days, the draft is watermarked as a draft, and `npm run verify` passes.

### 9. Timesheets — Issue invoice
The original hands billable days to the invoicing system with net, VAT and
gross already worked out. In the port the two apps do not speak.

**Done when** issuing from a month creates a real invoice carrying one line per
billable day at the day rate, the timesheet records that it was issued and
refuses to issue the same period twice, and `npm run verify` passes.

### 10. Monthly Overview is the wrong page
This is the one I got most wrong, so it is written plainly: the original is an
**administrators-only whole-team calendar**, and what was built is a personal
hours summary. Not a thinner version — a different screen.

`50eeaf69-overview.html:123` — "This overview is only available to
administrators."

- [ ] The grid: every person down the side, every **working day** across the
      top, Monday to Friday only
- [ ] Eleven activity colours, with Annual Leave orange and Sick red so absence
      is visible at a glance
- [ ] A legend
- [ ] Stacked bars per day, scaled to the busiest single day in the month
- [ ] Per-activity totals across all staff, and a grand total
- [ ] `Print / PDF`

**Held question inside this task:** the original is admin-only; the port shows
a personal view to everybody. Keeping both is probably right — the personal
view is useful and costs nothing — but that is a decision, not a default. Build
the grid for admins and leave the personal view where it is, and say so in the
pull request.

**Done when** a month with three people and a mix of activities renders one row
per person, weekends absent, absence in its own colours, totals that sum to the
grand total, and a print stylesheet. Screenshots at 390, 768, 1024 and 1440.

### 11. Admin — the three controls that are missing
- [ ] `Resend` an invitation
- [ ] `Remove` somebody
- [ ] Mileage rates, and `Download their claim (PDF)` — see task 6
- [ ] Everybody's invoices, read-only

**Done when** each control re-checks the caller (rule 5), a non-admin calling
any of them is refused, removal is recorded in the audit trail, and
`npm run verify` passes.

### 12. The runner opens a second pull request for work it already did
`overnight.sh:403` excludes draft pull requests from claiming a task. That is
deliberate and the reasoning above it is sound: a draft is what exit 69 leaves
behind when verify failed, and that task does need doing again.

The cost is what happened with #35/#36 and #38/#39 — the task is redone, a
second pull request opens, and the failed draft stays open forever. Two pull
requests for one task, and a queue of drafts nobody closes.

The fix is not to let drafts claim tasks; that would strand a task behind a
draft that is never cleaned up. It is to close the superseded draft when a
later run finishes the same task, saying in the comment which pull request
replaced it.

**Done when** a run that completes a task an open draft attempted closes that
draft with a comment naming the new pull request, a draft for a *different*
task is left alone, and rule 12 is answered in the comment: what would have to
be true for this to close a draft that was still wanted.

## Next up — Power Suite hygiene

### 2. Delete the import script at cutover
`scripts/import-staff.ts` is a one-off. Once the staff list is in Supabase and
the admin screen is the way access is granted, the script is a loaded gun: it
overwrites every access flag from a CSV. Remove it — with `scripts/staff-csv.ts`
and `tests/staff-csv.spec.ts`, which exist only to serve it — and its
`import:staff` script, in the pull request that cuts the domain over.

Last, and only after the import has actually run. Do not pick it up before then
— and note it deletes the parser those tests cover, which is the right order
round.

**Done when** the script is gone, `npm run verify` still passes, and README no
longer tells anybody to run it.

### 4. A 404 and a crash that look like the product
There is no `not-found.tsx` and no `error.tsx` anywhere in `src/`. Both cases
render Next's own page today.

That matters more here than it usually would. Rule 4 says a route 404s for
anybody without its flag, and that 404 is not an edge case — it is the designed
answer to somebody trying `/invoices` to see what happens. What they get is an
unstyled Next page, which tells them two things we would rather not say: that
they reached something real, and what it is built with.

Add `src/app/not-found.tsx`, `src/app/error.tsx`, and `global-error.tsx` — the
last one catches a failure in the root layout, which `error.tsx` cannot. They
should look like the rest of the suite and say nothing about what was missing or
why: no path, no flag name, no stack, no "you do not have access to this".

`error.tsx` is a client component and takes `{ error, reset }`. Log the digest,
show the person nothing but a way back to the portal.

Note for the test: the harness fails any test whose page logged a console error,
so exercising `error.tsx` needs `test.use({ tolerate: [...] })` in the same
spirit as the 404 tests already do — declare it, do not turn the check off.

**Done when** a signed-in request to a route the person has no flag for renders
the suite's own 404 rather than Next's; a test asserts the body names no route,
no flag and no framework; the 404 renders at 390 and 1440 with screenshots
attached; and `npm run verify` passes.
### 5. Content-Security-Policy
`next.config.ts` sets `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy` and `Permissions-Policy`, and `tests/hardening.spec.ts`
asserts the first three. Vercel adds `Strict-Transport-Security` on top of
those. The one header nothing sets is `Content-Security-Policy`.

CSP is the one that would have mattered. What this project spent its first month
removing was a `Sites.ReadWrite.All` token sitting in a browser, and the
argument behind every server-side decision since is that a script running on the
page must not be able to reach anything. Nothing enforces that; it is a property
of the code holding, not something checked.

The app is unusually well placed for a strict policy. Fonts are self-hosted,
jsPDF is bundled rather than fetched from cdnjs, and `tests/margin.spec.ts`
already asserts the page makes no off-site request at all. `default-src 'self'`
should be close to reachable.

The hard part is Next's inline scripts. Use a nonce issued from `src/proxy.ts`
rather than leaving `script-src` open — and if a nonce cannot be made to work
with this version of Next under Turbopack, **say so in the pull request with
what you tried**, rather than shipping `'unsafe-inline'` on `script-src`
quietly. A CSP with `'unsafe-inline'` on scripts is the rule 12 shape: a header
that is present, asserted, and not stopping the thing it names.

**HSTS is already there** and this task should not re-add it. Checked against
the deployment on 9 September: Vercel serves
`strict-transport-security: max-age=63072000; includeSubDomains; preload` on its
own, and `content-security-policy` is the only one of the six that is absent.
Setting HSTS in `next.config.ts` as well would be a second source of truth for a
header that is already correct — and a weaker `max-age` there would quietly
override the good one. Leave it to Vercel and say so in the pull request.

If a test asserts HSTS, it has to allow for localhost not sending it, because
localhost is not https. Assert it where it is served or not at all; an assertion
that passes because the header is absent everywhere it is checked is the rule 12
shape again.

**Done when** every response carries a `Content-Security-Policy`;
`tests/hardening.spec.ts` asserts it alongside the four it already checks; no page
in the suite logs a CSP violation — the harness already fails a test whose page
logged a console error, so the suite passing at all is the check; and
`npm run verify` passes.
### 4. A 404 and a crash that look like the product
There is no `not-found.tsx` and no `error.tsx` anywhere in `src/`. Both cases
render Next's own page today.

That matters more here than it usually would. Rule 4 says a route 404s for
anybody without its flag, and that 404 is not an edge case — it is the designed
answer to somebody trying `/invoices` to see what happens. What they get is an
unstyled Next page, which tells them two things we would rather not say: that
they reached something real, and what it is built with.

Add `src/app/not-found.tsx`, `src/app/error.tsx`, and `global-error.tsx` — the
last one catches a failure in the root layout, which `error.tsx` cannot. They
should look like the rest of the suite and say nothing about what was missing or
why: no path, no flag name, no stack, no "you do not have access to this".

`error.tsx` is a client component and takes `{ error, reset }`. Log the digest,
show the person nothing but a way back to the portal.

Note for the test: the harness fails any test whose page logged a console error,
so exercising `error.tsx` needs `test.use({ tolerate: [...] })` in the same
spirit as the 404 tests already do — declare it, do not turn the check off.

**Done when** a signed-in request to a route the person has no flag for renders
the suite's own 404 rather than Next's; a test asserts the body names no route,
no flag and no framework; the 404 renders at 390 and 1440 with screenshots
attached; and `npm run verify` passes.

---

## Held — needs a person

- Creating the Supabase projects and applying `0001_staff.sql` and
  `0002_signin_rate_limit.sql` (BLOCKED.md)
- Turning off email signups and pointing Supabase Auth's SMTP at Resend
- Exporting the SharePoint Staff list to CSV and running the one-off import
- Pointing `portal.poweranalytix.co.uk` at Vercel
- Porting the seven apps (`docs/PORTING-APPS.md`) — agreed in principle, queued
  one at a time. Margin and Tax Breakdown are first and need no data migration.
- Narrowing `admin.html`'s `AllSites.FullControl` on the live suite
- **Saying whether the keep-alive keeps anything alive.** It answered 200 every
  day for a week while portal-staging drifted towards being paused, which is
  where rule 12 came from. It now runs a real query rather than a health check,
  and has answered 200 every morning since 3 September. That is the same
  evidence as before. What was never established is whether Supabase counts a
  `select` as activity at all. Supabase warned on 1 September; if a second
  warning arrives, selects do not count and the next thing to try is a write —
  an insert into `signin_attempts`, which already expires rows out of itself.
  Held because only a person can say whether a warning came. It cannot be
  checked at 3am, and writing that down is better than pretending it can.
- **Why `getUser()` sees nobody on Vercel.** Sign-in works against a local dev
  server and against a local production build, and not on the deployment. The
  logging from PR #10 is on main; reading what it prints needs a redeploy and
  somebody with the Vercel runtime logs open.

---

## Done

- **One way to make a PDF** — `overnight/suite-theme`. `src/lib/pdf/` now holds
  the part five documents share: loading jsPDF and autotable dynamically,
  setting up A4 in either unit, the suite's colours, the seller header with the
  logo from My Profile, the money and date formatters the live pages use, and
  reading back where the last table ended. Margin's report moved onto it and
  produces the same document — `tests/margin.spec.ts` asserts the filename and
  that nothing is fetched off-site, and still passes.

  Two things deliberately not standardised. Margin keeps points while the new
  documents use millimetres, because Margin is already correct and converting
  every coordinate would gain nothing a reader sees. And it keeps its own money
  formatter: `gbp` rounds to whole pounds and groups thousands because these are
  planning figures, where `money` prints exact pence because an invoice is an
  amount somebody transfers. One formatter would make an invoice say £1,234.

  The toolkit's own surface — the header, the formatters — is exercised by the
  invoice document rather than by a page built to test it. A fixture page would
  pass while the real caller was broken, which rule 12 says is not a check.

- **Ported Tax Breakdown** — `overnight/auto-2026-09-12-0300`. The second app
  folded in, and the last one that touches no data. Most of the work was step 1
  of the port checklist: `taxbreakdown.html` carries ten references to MSAL,
  `msal-browser@3` from jsdelivr, a hard-coded Entra client id and tenant id, and
  a Sign out button of its own — in front of a calculator whose only scope is
  `User.Read` and which never calls Graph. None of it came across; `requireApp`
  and the magic link do that job, and a public page stopped advertising an app
  registration id. The sums are in `src/lib/tax-model.ts` with no DOM near them,
  and `tests/tax-breakdown.spec.ts` pins them against **four** worked examples
  read off the live page itself, run headless with every http(s) request aborted
  — between them the small profits rate, the marginal relief band, the main
  rate, a loss, the personal allowance tapering to nil, other PAYE income
  stacked under this company's salary, both AMAP mileage bands, and the
  Employment Allowance on and off. The figures the editing test drives were read
  the same way rather than worked out by hand. On the numbers: the statutory
  rates came across exactly as they are — 19%/25% with marginal relief of 3/200,
  the £12,570 allowance and its taper, 10.75/35.75/39.35% on dividends, NI at
  8%/2% and 15%, AMAP at 45p/25p — and only the default *inputs* became
  placeholders. Two judgement calls are written down in the model rather than
  made quietly: the £12,570 default salary is the personal allowance itself and
  stayed, and so did the mileage rates. `paTaxBreakdownInputs_v1` keeps its key
  and its exact JSON shape, so a browser that has used the live page keeps its
  figures. One deliberate piece of ugliness survived: the live page prints `£-0`
  for a negated zero, and so does this, because a port that quietly improves its
  output has stopped agreeing with the page it replaces. A test asserts the page
  fetches nothing off-site and that `msal`, both Entra identifiers and the two
  Microsoft hostnames appear nowhere in what this origin serves — and that it
  scanned the HTML and the JavaScript, rather than passing on an empty scan. One
  thing fixed on the way: the two-context deactivation check in `admin.spec.ts`
  ran out of its 30s budget once four more full-page screenshots were competing
  for the same server, so it now has 60s — the same assertions, a slower
  failure. No migration; nothing waiting on a person. 149 checks.
- **Accessibility pass on the admin table** — `overnight/auto-2026-09-13-0300`.
  axe now runs against the sign-in card, the tiles and the staff screen at 390
  and 1440, with the screenshot attached to each, and nothing is excluded and no
  rule is switched off. It found six things. Five were contrast: the "off" pill's
  label at 2.42:1, "invited, not signed in" at 4.42:1, a deactivated person's
  name and address at 2.58:1, and the faded "on" pills on a deactivated row at
  1.87:1. That last one is why opacity is gone from the table — the only value
  that passes is 0.88, at which nothing looks faded, so the pill is drained and
  its label left dark instead. The sixth was that the page every stranger reaches
  had no level-one heading at all: the sign-in card's "Power Suite" was a div and
  is now the `h1` it already looked like. Colours moved only where axe named
  them, and one dead rule went with them — `.toggle.off[disabled]` failed at
  1.81:1 and styles a state that cannot occur, since the only disabled toggles
  are your own Admin and your own Active and neither is off for anybody who can
  load the screen.
  Then the three things axe cannot see. The column headings were abbreviated with
  `display: none` below 720px, so a screen reader announced "Marg" for every
  toggle in that column; the full word is now visually hidden rather than removed
  and is what is announced at both widths, while what is drawn stays short — and
  the test measures the boxes rather than reading innerText, because at 390 both
  spellings are in the markup and that is the whole trick. A toggle's name now
  says the person the way the row header does — "Invoices for Nora Noflags", not
  their address — and a disabled one says why, since a disabled button is not
  focusable and never shows its `title` to a keyboard. Tab walks a row left to
  right across all seven and off the end onto the next person, which is asserted
  rather than assumed.
  One scan lives in `admin.spec.ts` rather than with the others: axe reads colour
  off what is rendered, and a populated audit trail needs a write, so it is
  scanned inside the serial suite that is already allowed to write instead of a
  second suite resetting the shared store beside it. Every fix was watched to
  fail without it — reverting the five colours, the heading, the `h1` and the
  toggle names fails six of the new checks.
  `@axe-core/playwright` is a devDependency and reaches no browser;
  `check:secrets` still passes. The admin screen does still scroll sideways at
  390 — that predates this, is recorded against the audit trail tests, and is a
  change to how the screen looks rather than an accessibility violation, so it
  is left for a person. No migration; nothing waiting on a person. 147 checks.
- **Monthly Overview has a tile and a route** — `overnight/auto-2026-09-17-0300`.
  The gap between docs/PORTING-APPS.md's nine apps and the portal's seven: the
  eighth is now routed. All of CLAUDE.md's checklist and none of the page — an
  entry in `src/lib/apps.ts`, a glyph, `/overview` behind `requireApp("overview")`
  with the same placeholder the other unported apps carry, `has_overview` in
  `0003_overview.sql`, a `Flag`, an Overview column in `StaffTable`, and cases in
  both `tests/access-matrix.spec.ts` and `tests/app-routes.spec.ts`. The page
  itself is deliberately not ported: it reads four SharePoint lists and runs into
  the "staff names versus staff records" question docs/PORTING-APPS.md records as
  unsettled, which is a decision and not a task. A fixture person of their own,
  `overview.only@example.test`, holds the flag and nothing else, so "sees exactly
  Monthly Overview and My Profile" is a real assertion rather than a subset of
  Ada Everything's. The 390 width check was strengthened while it was open: it
  asserted the page did not scroll sideways but never that anything was on it, so
  it would have passed just as happily on a portal that had lost a tile — it now
  counts them against `ALL_TILES` first, which is what makes "at 390 with eight
  tiles" mean anything. One thing shaken out on the way: the eighth toggle column
  pushed the admin screen's re-render past the 5s default, and
  `tests/admin.spec.ts` lost that race on a full run. Every toggle in that suite
  now goes through one `setToggle` helper that waits 15s for the row to come back
  showing the new state — the same patience the invite check was given, and a
  stronger check than the bare clicks three of those tests used to do, which
  asserted on a panel without ever confirming the toggle had moved. No entry in
  `src/lib/notify.ts`: its `APP_NAMES` covers Invoices, Timesheets, Expenses and
  Admin and has never covered Margin or Tax Breakdown either, so an
  access-change email names the raw flag for all three. That is a pre-existing
  gap, not this task's, and worth a queued line of its own. The migration is
  committed and **waiting on a person**. 139 checks.
- **A Content-Security-Policy, with a nonce** — `overnight/auto-2026-09-16-0300`.
  The sixth header, and the one the whole project was an argument for: no
  Supabase key is in the bundle and no token is in browser storage, but nothing
  made a script on the page unable to reach anything — that was a property of the
  code holding. `default-src 'self'` and no `'unsafe-inline'` on `script-src`.
  The nonce works under Next 16.3.2 and Turbopack: `src/proxy.ts` mints 128 bits
  per request, sets the policy on the request as well as the response, and Next
  reads it back out to stamp every script tag — asserted by reading the served
  HTML, because a browser blanks the `nonce` attribute once it has read it. Two
  callers of one `contentSecurityPolicy()` rather than two literals: the proxy's
  nonced one, and a nonce-free floor in `next.config.ts` under the chunks, the
  fonts and the logo, which the proxy's matcher skips. Where both apply the
  proxy's wins, which was checked rather than assumed. Three things came out of
  it. Next's own 404 page carries a `<style>` element built on the client, so it
  takes no nonce — a hash names that one string, and when Next changes it every
  404 test fails on a console error, which is the check. Nothing is prerendered
  any more: Next's 404 was baked at build time with no nonce and arrived with the
  console full of violations, so the root layout is `force-dynamic` — every other
  route already was. And `style-src-attr 'unsafe-inline'`, because React writes a
  `style` attribute for anything computed and no nonce or hash mechanism reaches
  an attribute; `style-src` itself stays strict. HSTS is Vercel's and was left
  alone — asserting it here could only pass by accepting its absence over http on
  127.0.0.1. `'unsafe-eval'` and inline styles are allowed under `next dev` only,
  keyed on NODE_ENV, which the suite never runs under. Five new checks, and both
  of the ones that matter were watched to fail against `script-src 'self'
  'unsafe-inline'`. No migration; nothing waiting on a person. 138 checks.
- **A 404 and a crash that look like the product** — `overnight/auto-2026-09-15-0300`.
  Rule 4's 404 is not an edge case, it is the answer somebody gets for trying
  `/invoices` to see what happens, and until now it was answered by Next's own
  page: "404 | This page could not be found", system font, no brand. There is now
  `src/app/not-found.tsx`, `src/app/error.tsx` and `src/app/global-error.tsx`,
  the first two sharing one `TroubleCard` so the "not here" screen and the "went
  wrong" screen are indistinguishable — a different card for a route that exists
  would be the 403 this project refused to serve, wearing a hat. Built from the
  sign-in card's own classes, not new ones, because restyling is a person's job;
  the only CSS added centres `.card-note`, which is capped at 56ch for the admin
  screen's prose and reads as a block shoved left inside a centred card.
  `error.tsx` logs the digest and shows nothing else: no stack, no path, no
  digest on the page, and `reset` is deliberately not rendered. `global-error.tsx`
  carries its own `<html>` and inline styles because the layout that imports
  globals.css is the thing that failed — and nothing in the suite can exercise
  it, since a test that shipped a broken root layout to prove the fallback works
  would be its own outage. That one is reviewed by reading it, which is said here
  rather than pretended otherwise.
  `src/app/api/test/crash/` throws so the suite can see `error.tsx` for real —
  under `/api/test` with the seeder and the ledger, so there is one test-mode
  namespace and not two, and 404 outside `E2E_TEST_MODE` like its neighbours. The
  harness grew one change to go with it: `tolerate` now filters the 5xx and
  `pageerror` lines as well as console output, because the test that renders the
  error boundary needs the 500 that put it there. It is matched against the same
  strings that would be reported, so `500 from …/api/test/crash` excuses that one
  request and no other — a 500 from anywhere else in that test still fails it.
  All eight new checks were watched to fail with `not-found.tsx` and `error.tsx`
  taken away.
  **One thing found and not fixed, which the next person should decide on.** The
  rendered 404 names nothing, and that is what the test asserts. The *markup*
  still does: Next streams the requested segment's resolved metadata into the
  flight payload, so the HTML for a 404 on `/invoices` contains the string
  "Invoices — Power Analytix" and the HTML for a 404 on a nonsense path does not.
  The two also differ in length, because an unknown path renders the static
  `/_not-found` and a guarded one renders the error fallback. So a signed-in
  person can still tell a route that exists from one that does not, by reading
  the source rather than the screen. Closing the metadata half means moving every
  guarded route's `metadata` export to a `generateMetadata` that resolves access
  first — which doubles the staff lookup per page load unless `getCurrentUser`
  and `resolveAccess` are wrapped in React's `cache()` first. That is a change to
  the one place that answers "who is this", and not one to make unattended on the
  way past. Closing the length half is a fight with Next that may not be
  winnable. Neither is a leak of who has what, and the tile names are already
  public in `docs/PORTING-APPS.md`; it is a leak of which routes are real.
  No migration; nothing waiting on a person. 142 checks.
- **A Content-Security-Policy, with a nonce** — `overnight/auto-2026-09-16-0300`.
  The sixth header, and the one the whole project was an argument for: no
  Supabase key is in the bundle and no token is in browser storage, but nothing
  made a script on the page unable to reach anything — that was a property of the
  code holding. `default-src 'self'` and no `'unsafe-inline'` on `script-src`.
  The nonce works under Next 16.3.2 and Turbopack: `src/proxy.ts` mints 128 bits
  per request, sets the policy on the request as well as the response, and Next
  reads it back out to stamp every script tag — asserted by reading the served
  HTML, because a browser blanks the `nonce` attribute once it has read it. Two
  callers of one `contentSecurityPolicy()` rather than two literals: the proxy's
  nonced one, and a nonce-free floor in `next.config.ts` under the chunks, the
  fonts and the logo, which the proxy's matcher skips. Where both apply the
  proxy's wins, which was checked rather than assumed. Three things came out of
  it. Next's own 404 page carries a `<style>` element built on the client, so it
  takes no nonce — a hash names that one string, and when Next changes it every
  404 test fails on a console error, which is the check. Nothing is prerendered
  any more: Next's 404 was baked at build time with no nonce and arrived with the
  console full of violations, so the root layout is `force-dynamic` — every other
  route already was. And `style-src-attr 'unsafe-inline'`, because React writes a
  `style` attribute for anything computed and no nonce or hash mechanism reaches
  an attribute; `style-src` itself stays strict. HSTS is Vercel's and was left
  alone — asserting it here could only pass by accepting its absence over http on
  127.0.0.1. `'unsafe-eval'` and inline styles are allowed under `next dev` only,
  keyed on NODE_ENV, which the suite never runs under. Five new checks, and both
  of the ones that matter were watched to fail against `script-src 'self'
  'unsafe-inline'`. No migration; nothing waiting on a person. 138 checks.
- **Monthly Overview has a tile and a route** — `overnight/auto-2026-09-17-0300`.
  The gap between docs/PORTING-APPS.md's nine apps and the portal's seven: the
  eighth is now routed. All of CLAUDE.md's checklist and none of the page — an
  entry in `src/lib/apps.ts`, a glyph, `/overview` behind `requireApp("overview")`
  with the same placeholder the other unported apps carry, `has_overview` in
  `0003_overview.sql`, a `Flag`, an Overview column in `StaffTable`, and cases in
  both `tests/access-matrix.spec.ts` and `tests/app-routes.spec.ts`. The page
  itself is deliberately not ported: it reads four SharePoint lists and runs into
  the "staff names versus staff records" question docs/PORTING-APPS.md records as
  unsettled, which is a decision and not a task. A fixture person of their own,
  `overview.only@example.test`, holds the flag and nothing else, so "sees exactly
  Monthly Overview and My Profile" is a real assertion rather than a subset of
  Ada Everything's. The 390 width check was strengthened while it was open: it
  asserted the page did not scroll sideways but never that anything was on it, so
  it would have passed just as happily on a portal that had lost a tile — it now
  counts them against `ALL_TILES` first, which is what makes "at 390 with eight
  tiles" mean anything. One thing shaken out on the way: the eighth toggle column
  pushed the admin screen's re-render past the 5s default, and
  `tests/admin.spec.ts` lost that race on a full run. Every toggle in that suite
  now goes through one `setToggle` helper that waits 15s for the row to come back
  showing the new state — the same patience the invite check was given, and a
  stronger check than the bare clicks three of those tests used to do, which
  asserted on a panel without ever confirming the toggle had moved. No entry in
  `src/lib/notify.ts`: its `APP_NAMES` covers Invoices, Timesheets, Expenses and
  Admin and has never covered Margin or Tax Breakdown either, so an
  access-change email names the raw flag for all three. That is a pre-existing
  gap, not this task's, and worth a queued line of its own. The migration is
  committed and **waiting on a person**. 139 checks.
- **Accessibility pass on the admin table** — `overnight/auto-2026-09-13-0300`.
  axe now runs against the sign-in card, the tiles and the staff screen at 390
  and 1440, with the screenshot attached to each, and nothing is excluded and no
  rule is switched off. It found six things. Five were contrast: the "off" pill's
  label at 2.42:1, "invited, not signed in" at 4.42:1, a deactivated person's
  name and address at 2.58:1, and the faded "on" pills on a deactivated row at
  1.87:1. That last one is why opacity is gone from the table — the only value
  that passes is 0.88, at which nothing looks faded, so the pill is drained and
  its label left dark instead. The sixth was that the page every stranger reaches
  had no level-one heading at all: the sign-in card's "Power Suite" was a div and
  is now the `h1` it already looked like. Colours moved only where axe named
  them, and one dead rule went with them — `.toggle.off[disabled]` failed at
  1.81:1 and styles a state that cannot occur, since the only disabled toggles
  are your own Admin and your own Active and neither is off for anybody who can
  load the screen.
  Then the three things axe cannot see. The column headings were abbreviated with
  `display: none` below 720px, so a screen reader announced "Marg" for every
  toggle in that column; the full word is now visually hidden rather than removed
  and is what is announced at both widths, while what is drawn stays short — and
  the test measures the boxes rather than reading innerText, because at 390 both
  spellings are in the markup and that is the whole trick. A toggle's name now
  says the person the way the row header does — "Invoices for Nora Noflags", not
  their address — and a disabled one says why, since a disabled button is not
  focusable and never shows its `title` to a keyboard. Tab walks a row left to
  right across all seven and off the end onto the next person, which is asserted
  rather than assumed.
  One scan lives in `admin.spec.ts` rather than with the others: axe reads colour
  off what is rendered, and a populated audit trail needs a write, so it is
  scanned inside the serial suite that is already allowed to write instead of a
  second suite resetting the shared store beside it. Every fix was watched to
  fail without it — reverting the five colours, the heading, the `h1` and the
  toggle names fails six of the new checks.
  `@axe-core/playwright` is a devDependency and reaches no browser;
  `check:secrets` still passes. The admin screen does still scroll sideways at
  390 — that predates this, is recorded against the audit trail tests, and is a
  change to how the screen looks rather than an accessibility violation, so it
  is left for a person. No migration; nothing waiting on a person. 147 checks.
- **Ported Tax Breakdown** — `overnight/auto-2026-09-12-0300`. The second app
  folded in, and the last one that touches no data. Most of the work was step 1
  of the port checklist: `taxbreakdown.html` carries ten references to MSAL,
  `msal-browser@3` from jsdelivr, a hard-coded Entra client id and tenant id, and
  a Sign out button of its own — in front of a calculator whose only scope is
  `User.Read` and which never calls Graph. None of it came across; `requireApp`
  and the magic link do that job, and a public page stopped advertising an app
  registration id. The sums are in `src/lib/tax-model.ts` with no DOM near them,
  and `tests/tax-breakdown.spec.ts` pins them against **four** worked examples
  read off the live page itself, run headless with every http(s) request aborted
  — between them the small profits rate, the marginal relief band, the main
  rate, a loss, the personal allowance tapering to nil, other PAYE income
  stacked under this company's salary, both AMAP mileage bands, and the
  Employment Allowance on and off. The figures the editing test drives were read
  the same way rather than worked out by hand. On the numbers: the statutory
  rates came across exactly as they are — 19%/25% with marginal relief of 3/200,
  the £12,570 allowance and its taper, 10.75/35.75/39.35% on dividends, NI at
  8%/2% and 15%, AMAP at 45p/25p — and only the default *inputs* became
  placeholders. Two judgement calls are written down in the model rather than
  made quietly: the £12,570 default salary is the personal allowance itself and
  stayed, and so did the mileage rates. `paTaxBreakdownInputs_v1` keeps its key
  and its exact JSON shape, so a browser that has used the live page keeps its
  figures. One deliberate piece of ugliness survived: the live page prints `£-0`
  for a negated zero, and so does this, because a port that quietly improves its
  output has stopped agreeing with the page it replaces. A test asserts the page
  fetches nothing off-site and that `msal`, both Entra identifiers and the two
  Microsoft hostnames appear nowhere in what this origin serves — and that it
  scanned the HTML and the JavaScript, rather than passing on an empty scan. One
  thing fixed on the way: the two-context deactivation check in `admin.spec.ts`
  ran out of its 30s budget once four more full-page screenshots were competing
  for the same server, so it now has 60s — the same assertions, a slower
  failure. No migration; nothing waiting on a person. 149 checks.
- **Renamed the product to Power Suite** — `overnight/auto-2026-09-10-0300`.
  The product is Power Suite; the company is still Power Analytix. The tab now
  reads "Power Suite — Power Analytix", matching the pattern the app routes
  already used, and the line above every heading — the sign-in card, the tiles,
  and the shell each carried their own copy of "Suite Portal" — reads Power
  Suite. `tests/product-name.spec.ts` pins the tab and the heading signed in and
  signed out, at 390 and 1440, reading the rendered text rather than a constant:
  rename either back and it fails. Not only the visible strings — a comment that
  calls the product "the portal" is how a half-rename comes back, so those moved
  too, splitting into "Power Suite" where the product was meant and "the tiles
  page" where `src/app/page.tsx` was. Left alone deliberately: everything that
  names the *old* suite (`BigWez79/portal`, `portal_index.html`, "the live
  portal", "Portal v2.0") is a different thing and still true, and no identifier
  moved — launchd labels, the plists, `PORTAL_*`, `~/portal`, the package name,
  the `Portal` component, the CSS class names. The two email templates in
  `supabase/email-templates/` said "the portal" as well; they are edited here but
  have never been pasted into Supabase (that is blocked on SMTP), so nothing has
  drifted out of step — whoever pastes them gets the new wording. `deploy/` needed
  no change: every "portal" in it is a launchd label, a Supabase project name or a
  path on disk. One thing fixed on the way: the invite check in `admin.spec.ts`
  was waiting the default 5s on a server action doing file I/O, and lost the coin
  flip once on a loaded box — it now waits 15s for the same message, which is a
  slower failure rather than a weaker check. No migration; nothing waiting on a
  person. 134 checks.
- **Deactivating somebody ends their session too** — `overnight/auto-2026-09-05-0300`.
  Deactivation already took their access away on the next page load; what was
  left was the cookie, so they saw a signed-in portal carrying a notice rather
  than the sign-in card. A signed-in request whose staff row says inactive now
  goes to `/auth/sign-out`, which ends the session and returns them to the card.
  A route handler and not the page, because a server component's cookie jar is
  read-only — the page can tell the session should not continue, only a handler
  can clear what makes it continue. Not `auth.admin.signOut(userId, "global")`
  as the task asked: that method takes the *target's* JWT, which an admin does
  not hold, and it would have been a third use of the service role. The same
  revocation happens on the request that carries the session instead —
  `signOut({ scope: "global" })` against the caller's own — which also catches a
  row deactivated by SQL or by the import rather than only by the toggle.
  Guarded routes still 404 rather than redirecting: a redirect would tell a
  deactivated person which routes exist, which is what rule 4 removes. No row at
  all is left alone on purpose — a lookup that failed looks identical from here,
  and signing people out over a failed query is its own outage. The Sign out
  button shares the same `endSession`, which fixed it doing nothing under the
  suite. All three new checks were watched to fail with the redirect taken out.
  No migration; nothing waiting on a person. 130 checks.
- **Showed the audit trail on the admin screen** — `overnight/auto-2026-09-03-0300`.
  `staff_audit` has recorded every change since 0001 and nothing read it; there
  is now a panel per person under the staff table, newest first, saying what
  moved and who moved it. Read through the caller's own session, so the "admins
  read the audit" policy is what returns anything — and `changed_by` is resolved
  to a name from `staff`, read the same way, rather than by adding a foreign key
  and a migration for a join a second small query does. An entry where no flag
  moved is dropped: the sign-in trigger writes `last_seen_at` and that is not a
  decision anybody made. The fixture store grew a matching trail so the suite can
  exercise the panel with no Supabase — one file per person, like the sign-in
  ledger, and cleared by the same reset. No migration; nothing waiting on a
  person. 128 checks.
- **Rate-limited the sign-in form** — `overnight/auto-2026-09-02-0300`. Five
  links per address per minute, twenty per IP per fifteen minutes, counted in
  `signin_attempts` rather than in memory so a redeploy hands nobody a fresh
  allowance. Refusal is silent: over the limit, under it and unknown are all
  told the same thing, so the form still cannot be used to find out who works
  here. Written as a security definer function called with the anon role —
  neither an anonymous write policy nor the service role. `0002` is committed
  and waiting on a person. 122 checks.
- **Portal v3.0 scaffold** — sign-in, tiles, admin screen. First commit.
- **Off Microsoft** — Supabase Auth, RLS, staff admin screen, CSV import.
- **One app** — the apps became guarded routes; shared-cookie machinery
  dropped.
- **Matched the live suite** — surveyed `BigWez79/portal` and found the portal
  had been rebuilt against a six-week-old copy: seven tiles, not four. Added
  Margin, Tax Breakdown and My Profile, two access flags, three routes. 64 checks.
- **Ported Margin & Profit Split** — `overnight/port-margin`. The first app
  folded in. Sums in `src/lib/margin-model.ts`, checked against three worked
  examples read off the live page; jsPDF bundled instead of fetched from cdnjs;
  placeholder defaults. Also fixed a latent race in the fixture store that the
  extra tests brought out. 78 checks.
- **Tested the CSV parser** — `overnight/auto-2026-08-31-0300`. The reading of
  the staff CSV moved to `scripts/staff-csv.ts`, away from the half that talks
  to Supabase, and 41 checks pin the mapping: `Title` → email, what counts as
  Yes, commas inside quotes, duplicates, a row with no address, and the no
  active admin warning. Two quiet failure modes found and closed on the way: the
  BOM Excel writes made the email column go missing, and a flag column absent
  from the export imported everybody with it off without saying so — now a
  warning the dry run prints. Nothing here reaches Supabase or the filesystem.
  Two flakes the longer run brought out were fixed with it: the margin worked
  examples read the calculator before it had restored the seeded state, and the
  test-session helpers now survive one dropped keep-alive socket. 119 checks.

# Folding the suite in

Nine apps move off SharePoint into this repository, one at a time. This is the
agreed shape, the order, and the decisions already taken.

Survey of what is actually live: `BigWez79/portal`, commit `5d550d2`, read
25 August 2026.

## What is being moved

Nine pages, ~6,700 lines, all single-file HTML with inline MSAL and Graph calls,
served by GitHub Pages from one repository at `portal.poweranalytix.co.uk`.
There are no subdomains — the `invoices.poweranalytix.co.uk` links in older
copies are stale.

| App | Lines | Lists | Writes | State |
|---|---:|---:|---:|---|
| Portal | 209 | 1 | 0 | rebuilt |
| Margin & Profit Split | 848 | 0 | 0 | route ready |
| Tax Breakdown | 557 | 0 | 0 | route ready |
| Monthly Overview | 383 | 4 | 0 | not routed yet |
| My Profile | 375 | 5 | 2 | route ready |
| Expenses | 586 | 4 | 5 | route ready |
| Invoices | 1,004 | 6 | 12 | route ready |
| Admin | 1,099 | 16 | 13 | rebuilt (staff only) |
| Timesheets | 1,623 | 8 | 8 | route ready |

"Route ready" means the route exists here, behind `requireApp`, showing a
placeholder. Porting one is replacing that placeholder.

## Decisions already taken

**Everything moves.** All nine, one at a time, until nothing reads
`graph.microsoft.com`. Agreed 25 August.

**Own records only; admins see all.** When a table lands in Postgres, a person
reads their own rows and an active admin reads everybody's. This matches what
the live pages already do — Timesheets and Expenses filter on
`StaffEmail eq <you>`, Overview narrows to you, Admin reads everyone — so
nobody loses a view they have today. No manager-sees-team relationship is being
built.

**My Profile has no flag.** Every active staff member gets it, as on the live
portal. `requireApp("profile")` checks `access.isStaff`, not a column.

## The order, and why

1. **Margin**, then **Tax Breakdown**. Neither touches Graph — they are
   calculators. No migration, no policy, no data. They are the honest test of
   whether a page moves across cleanly while nothing is at stake.
2. **My Profile.** The smallest thing with real data behind it, and it forces
   the legacy-profile question (below) early rather than late.
3. **Monthly Overview.** Read-only, so it proves the read path and the RLS
   policies without risking a write.
4. **Expenses.** Smallest of the three big ones. First real write path.
5. **Timesheets.** Largest single file, and the one people open daily.
6. **Invoices.** Produces documents customers see.
7. **Admin.** Last, because it is the tool you would need in order to fix any of
   the others. Staff management is already rebuilt; customers and invoice admin
   follow their own apps.

## What each port involves

1. **Delete the sign-in.** No MSAL, no client id, no tenant id, no redirect
   handling. The person is signed in or they never reached the route.
2. **Delete the access check.** `requireApp` did it.
3. **Move the data.** A migration per list, an import, and an RLS policy. This
   is most of the work.
4. **Move the screens.** Markup and styles come across largely as they are.
5. **Server actions for anything that writes**, each re-checking the caller.
   Rendering a control is not a check.

Nested routes go under the same folder and call `requireApp` themselves. **Every
route calls the guard** — a layout is not a gate, because a nested route can be
requested directly.

## Margin, specifically

Read from the live page, 25 August: 848 lines, of which ~517 are inline script
and ~149 inline style.

- **No authentication at all.** Unlike every other page, `margin.html` has no
  MSAL and no sign-in. It is reachable by anyone with the URL. The ported route
  is behind sign-in and `has_margin`, which is a deliberate improvement.
- **jsPDF and jspdf-autotable load from cdnjs.** Install from npm and bundle
  them. A build that reaches the network is a build that fails on a bad night.
- **`localStorage` holds saved scenarios** under two keys. Per-browser scratch,
  not shared data. Leave it there for now; moving it to Postgres is a separate
  decision, not part of the port.
- **The default figures are real.** Replace them with obvious placeholders. The
  calculator behaves identically and the numbers stop being published.
- **Google Fonts are linked from the page.** This repo self-hosts Sora and
  Albert Sans already — use those, do not add the link back.

## Open questions, to be answered when they bite

**The legacy profile list.** `myprofile.html` reads both `profileListId` and a
`legacyProfileListId`, and `timesheet.html` reads the legacy one too. Whether
the legacy list is still authoritative for anybody decides whether it becomes a
table or is read once and retired. Answer this from the data during the My
Profile port — do not guess.

**Staff names versus staff records.** Under "own records only", a person can
read their own `staff` row and no other. Any ported page that needs to *display
a colleague's name* — Monthly Overview builds exactly such a lookup today —
will get nothing back. The likely answer is a `staff_directory` view exposing
only email, full name and active to any signed-in staff member, with the access
flags left behind the existing policy. Decide it when Overview is ported, not
before.

**Two settings lists.** Expenses and Invoices each reference a different
settings list. Whether these become one table or two depends on whether the
contents overlap. Look before merging them.

## While the migration is running

Ported pages live here; unported ones stay on GitHub Pages at the old address.
The two cannot share a sign-in, so people hold two sessions until an app has
moved. With nine apps that is not a fortnight, and it is the main cost of doing
this incrementally rather than in one cutover.

An app's old page is turned off by a person, a week after its route has been
live — never in the same change that ports it.

## One thing worth fixing on the live suite regardless

`admin.html` requests `AllSites.FullControl`, broader than the
`Sites.ReadWrite.All` every other page asks for and far broader than reading a
few lists needs. It is delegated, so it cannot exceed what that person could do
by hand, but a single cross-site scripting bug on that page would inherit their
whole SharePoint estate rather than one list. Narrowing it to
`Sites.ReadWrite.All`, or `Sites.Selected` on the PowerAnalytix site, is a
one-line change to a page that is being replaced anyway.

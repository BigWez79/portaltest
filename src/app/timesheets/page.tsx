import { AppShell } from "@/components/AppShell";
import { TimesheetsApp } from "@/components/timesheets/TimesheetsApp";
import { requireApp } from "@/lib/guard";
import { listEntries, lockedMonths } from "@/lib/timesheets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timesheets — Power Suite" };

/**
 * The fifth app folded in, and the one people open daily.
 *
 * Entries come back through the caller's own session, so row level security is
 * what limits them to this person's hours — there is no `.eq()` on staff_email
 * in the read path, on purpose. The live page filters in the browser.
 *
 * Grouping into months and days happens here rather than in SQL: a person logs
 * a few hundred rows a year, the grouping is pure arithmetic, and keeping it in
 * one function means the totals on screen and the totals in the tests come from
 * the same place.
 */
export default async function TimesheetsPage() {
  // 404s for anyone without the flag, including signed-out visitors.
  const access = await requireApp("timesheet");

  const [entries, locked] = await Promise.all([
    listEntries(access.email),
    lockedMonths(access.email),
  ]);

  return (
    <AppShell access={access} current="timesheet" title="Timesheets" wide>
      <TimesheetsApp entries={entries} locked={locked} />
    </AppShell>
  );
}

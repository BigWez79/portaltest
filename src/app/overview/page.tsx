import { AppShell } from "@/components/AppShell";
import { OverviewApp } from "@/components/overview/OverviewApp";
import { requireApp } from "@/lib/guard";
import { listVisibleEntries } from "@/lib/timesheets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monthly Overview — Power Suite" };

/**
 * The last app folded in, and the only one that shows another person's figures.
 *
 * It reads the timesheet entries the caller may see — their own, or everybody's
 * for an active admin — and that is decided by the policy rather than by a
 * branch here. So the "Administrators only" section the live page carries is
 * not a second query: the page notices it is holding more than one person's
 * rows and groups them.
 */
export default async function OverviewPage() {
  const access = await requireApp("overview");

  const entries = await listVisibleEntries(access.email, access.isAdmin);
  const months = [...new Set(entries.map((e) => e.claimMonth))].sort((a, b) => b.localeCompare(a));

  return (
    <AppShell access={access} current="overview" title="Monthly Overview" wide>
      <OverviewApp
        entries={entries}
        months={months}
        isAdmin={access.isAdmin}
        email={access.email}
      />
    </AppShell>
  );
}

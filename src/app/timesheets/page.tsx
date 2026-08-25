import { PortedAppNotice } from "@/components/PortedAppNotice";
import { AppShell } from "@/components/AppShell";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timesheets — Power Analytix" };

export default async function TimesheetsPage() {
  // 404s for anyone without the flag, including signed-out visitors.
  const access = await requireApp("timesheet");

  return (
    <AppShell access={access} current="timesheet" title="Timesheets">
      <PortedAppNotice app="Timesheets" blurb="log daily hours and activities" />
    </AppShell>
  );
}

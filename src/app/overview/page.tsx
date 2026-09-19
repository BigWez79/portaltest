import { PortedAppNotice } from "@/components/PortedAppNotice";
import { AppShell } from "@/components/AppShell";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monthly Overview — Power Analytix" };

export default async function OverviewPage() {
  const access = await requireApp("overview");

  return (
    <AppShell access={access} current="overview" title="Monthly Overview">
      <PortedAppNotice app="Monthly Overview" blurb="your month at a glance" />
    </AppShell>
  );
}

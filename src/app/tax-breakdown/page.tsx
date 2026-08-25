import { PortedAppNotice } from "@/components/PortedAppNotice";
import { AppShell } from "@/components/AppShell";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tax Breakdown — Power Analytix" };

export default async function TaxBreakdownPage() {
  const access = await requireApp("taxBreakdown");

  return (
    <AppShell access={access} current="taxBreakdown" title="Tax Breakdown">
      <PortedAppNotice app="Tax Breakdown" blurb="break a figure down by tax treatment" />
    </AppShell>
  );
}

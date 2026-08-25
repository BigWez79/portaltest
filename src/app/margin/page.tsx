import { PortedAppNotice } from "@/components/PortedAppNotice";
import { AppShell } from "@/components/AppShell";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Margin & Profit Split — Power Analytix" };

export default async function MarginPage() {
  const access = await requireApp("margin");

  return (
    <AppShell access={access} current="margin" title="Margin & Profit Split">
      <PortedAppNotice app="Margin & Profit Split" blurb="work out margin and how a job splits" />
    </AppShell>
  );
}

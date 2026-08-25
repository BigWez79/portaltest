import { PortedAppNotice } from "@/components/PortedAppNotice";
import { AppShell } from "@/components/AppShell";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices — Power Analytix" };

export default async function InvoicesPage() {
  // 404s for anyone without the flag, including signed-out visitors.
  const access = await requireApp("invoices");

  return (
    <AppShell access={access} current="invoices" title="Invoices">
      <PortedAppNotice app="Invoices" blurb="create, edit and print customer invoices" />
    </AppShell>
  );
}

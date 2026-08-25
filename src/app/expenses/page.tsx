import { PortedAppNotice } from "@/components/PortedAppNotice";
import { AppShell } from "@/components/AppShell";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses — Power Analytix" };

export default async function ExpensesPage() {
  // 404s for anyone without the flag, including signed-out visitors.
  const access = await requireApp("expenses");

  return (
    <AppShell access={access} current="expenses" title="Expenses">
      <PortedAppNotice app="Expenses" blurb="log expenses, mileage and monthly claims" />
    </AppShell>
  );
}

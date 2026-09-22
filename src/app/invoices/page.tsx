import { AppShell } from "@/components/AppShell";
import { InvoicesApp } from "@/components/invoices/InvoicesApp";
import { requireApp } from "@/lib/guard";
import { listCustomers, listInvoices, listLines, type InvoiceLine } from "@/lib/invoices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices — Power Suite" };

/**
 * The fourth app folded in, and the only one that produces a document somebody
 * outside the company reads.
 *
 * Invoices come back through the caller's own session, so row level security is
 * what limits them to this person's — there is no `.eq()` on seller_email in
 * the read path, on purpose. The lines are fetched for every invoice up front
 * rather than on expanding one: a seller has tens of invoices, not thousands,
 * and a page that is complete when it arrives beats one that fetches again
 * every time somebody opens a row.
 */
export default async function InvoicesPage() {
  // 404s for anyone without the flag, including signed-out visitors.
  const access = await requireApp("invoices");

  const [invoices, customers] = await Promise.all([
    listInvoices(access.email),
    listCustomers(),
  ]);

  const lineLists = await Promise.all(invoices.map((i) => listLines(i.id)));
  const linesByInvoice: Record<string, InvoiceLine[]> = {};
  invoices.forEach((inv, i) => {
    linesByInvoice[inv.id] = lineLists[i];
  });

  return (
    <AppShell access={access} current="invoices" title="Invoices" wide>
      <InvoicesApp
        invoices={invoices}
        customers={customers}
        linesByInvoice={linesByInvoice}
        // Nothing expanded on arrival. Opening the newest looked helpful until
        // it meant the first click on that invoice closed it — and with a list
        // of them, choosing one for somebody is a guess.
        openId={null}
      />
    </AppShell>
  );
}

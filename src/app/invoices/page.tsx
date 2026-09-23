import { AppShell } from "@/components/AppShell";
import { InvoicesApp } from "@/components/invoices/InvoicesApp";
import { requireApp } from "@/lib/guard";
import {
  listCustomers,
  listInvoices,
  listLines,
  nextInvoiceNo,
  type InvoiceLine,
} from "@/lib/invoices";
import { getProfile } from "@/lib/profile";

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

  const [invoices, customers, profile] = await Promise.all([
    listInvoices(access.email),
    listCustomers(),
    getProfile(access.email),
  ]);

  // Worked out here rather than in the browser: the next number depends on
  // every invoice this person has, and the browser only ever holds the ones it
  // was sent. `PA` is the live page's own fallback for somebody who has not set
  // a prefix on My Profile yet.
  const suggestedNo = nextInvoiceNo(
    invoices.map((i) => i.invoiceNo),
    profile.issuerPrefix || "PA",
  );

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
        suggestedNo={suggestedNo}
        openId={null}
      />
    </AppShell>
  );
}

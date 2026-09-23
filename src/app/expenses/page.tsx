import { AppShell } from "@/components/AppShell";
import { ExpensesApp } from "@/components/expenses/ExpensesApp";
import { getRates, listAllExpenses, listExpenses, lockedMonths } from "@/lib/expenses";
import { requireApp } from "@/lib/guard";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses — Power Suite" };

/**
 * The third app folded in, and the first that stores anything.
 *
 * Margin and Tax Breakdown are calculators — the port was the page. Here the
 * rows come back through the caller's own session, so row level security is
 * what limits them to this person's claims. There is no `.eq()` on the email
 * anywhere in the read path on purpose: a filter in the application reads like
 * the thing protecting the data, and on the live page that belief is what left
 * a client-side filter standing between one person's claims and everybody's.
 */
export default async function ExpensesPage() {
  // 404s for anyone without the flag, including signed-out visitors.
  const access = await requireApp("expenses");

  const [rows, rates, locked, profile] = await Promise.all([
    listExpenses(access.email),
    getRates(),
    lockedMonths(access.email),
    // Only for the logo and business name at the top of the claim. A claim is
    // an internal document, so none of the bank details go near it.
    getProfile(access.email),
  ]);

  // Everybody's, but only for an admin, and only so the Admin view can produce
  // somebody else's claim. A non-admin is sent an empty list rather than a
  // shorter one — there is nothing here for the browser to filter.
  const everybody = access.isAdmin ? await listAllExpenses() : [];

  return (
    <AppShell access={access} current="expenses" title="Expenses" wide>
      <ExpensesApp
        rows={rows}
        rates={rates}
        locked={locked}
        isAdmin={access.isAdmin}
        person={{ name: access.displayName || null, email: access.email }}
        seller={{ businessName: profile.businessName, logo: profile.logo }}
        everybody={everybody}
      />
    </AppShell>
  );
}

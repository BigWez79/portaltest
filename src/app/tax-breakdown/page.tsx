import { AppShell } from "@/components/AppShell";
import { TaxBreakdown } from "@/components/tax/TaxBreakdown";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tax Breakdown — Power Analytix" };

/**
 * The second of the seven to be folded in, and the last that touches no data.
 * The guard is unchanged — the calculator replaces the placeholder that stood
 * here while the port was queued.
 *
 * The live `taxbreakdown.html` puts MSAL in front of this: a sign-in with
 * `User.Read` and no Graph call behind it, plus an Entra client id and tenant id
 * printed on a public page. `requireApp` does that job here, so none of it came
 * across (docs/PORTING-APPS.md, step 1).
 */
export default async function TaxBreakdownPage() {
  const access = await requireApp("taxBreakdown");

  return (
    <AppShell access={access} current="taxBreakdown" title="Tax Breakdown" wide>
      <TaxBreakdown />
    </AppShell>
  );
}

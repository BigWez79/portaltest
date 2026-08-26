import { AppShell } from "@/components/AppShell";
import { MarginCalculator } from "@/components/margin/MarginCalculator";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Margin & Profit Split — Power Analytix" };

/**
 * The first of the seven to be folded in. The guard is unchanged — the
 * calculator simply replaces the placeholder that stood here while the port
 * was queued.
 *
 * Note what the guard buys: the live `margin.html` has no sign-in at all and is
 * reachable by anyone with the URL. Here it is behind a magic link and the
 * `has_margin` flag. That is an improvement, not a regression (TASKS.md P1).
 */
export default async function MarginPage() {
  const access = await requireApp("margin");

  return (
    <AppShell access={access} current="margin" title="Margin & Profit Split" wide>
      <MarginCalculator />
    </AppShell>
  );
}

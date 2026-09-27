import { AppShell } from "@/components/AppShell";
import { MarginSplitApp } from "@/components/admin/MarginSplitApp";
import { requireApp } from "@/lib/guard";
import { loadMarginSplit, summarise } from "@/lib/margin-split";

export const dynamic = "force-dynamic";
export const metadata = { title: "Margin Split — Power Suite" };

/**
 * Jobs feed a shared pot; contractors draw from it. Admin only.
 *
 * Not the Margin & Profit Split calculator at /margin, and not a tile: it is
 * part of the admin screen, so it is behind the admin gate and nothing else.
 * requireApp here and not only on /admin — a layout is not a gate (rule 9),
 * and this route can be asked for directly.
 */
export default async function MarginSplitPage() {
  const access = await requireApp("admin");
  const data = await loadMarginSplit();

  // Totals are worked out here, once, from integers. The browser is sent the
  // answer, not asked to reach it.
  const summary = summarise(data);

  return (
    <AppShell access={access} current="admin" title="Margin Split" wide>
      <MarginSplitApp data={data} summary={summary} />
    </AppShell>
  );
}

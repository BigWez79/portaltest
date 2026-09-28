import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { MarginSplit } from "@/components/admin/MarginSplit";
import { requireApp } from "@/lib/guard";
import { readBook, summarise } from "@/lib/margin-split";

export const dynamic = "force-dynamic";
export const metadata = { title: "Margin Split — Power Suite" };

/**
 * Jobs feed a shared pot and contractors draw from it. Admin-only, and not the
 * Margin & Profit Split calculator at /margin — no tile, no flag.
 */
export default async function MarginSplitPage() {
  // A 404 for anyone who is not an active admin, rule 4.
  const access = await requireApp("admin");
  const book = await readBook();

  return (
    <AppShell access={access} current="admin" title="Margin Split">
      <p className="back split-back">
        <Link href="/admin">← Staff access</Link>
      </p>
      <MarginSplit {...book} summary={summarise(book.jobs, book.contractors, book.drawings)} />
    </AppShell>
  );
}

import { TroubleCard } from "@/components/TroubleCard";

/**
 * Power Suite's own 404, and the reason it is worth having one.
 *
 * Rule 4 says a route 404s for anybody without its flag, so this is not an edge
 * case — it is the designed answer to somebody trying /invoices to see what
 * happens. Next's default page answered that with "404 | This page could not be
 * found" in a system font, which says two things we would rather not: that they
 * reached something real, and what it is built with.
 *
 * Every notFound() in the app lands here: requireApp's, and a genuinely unknown
 * address. They are the same screen on purpose. Telling them apart is telling
 * somebody which routes exist.
 */
export const metadata = { title: "Not found — Power Analytix" };

export default function NotFound() {
  return (
    <main className="shell gated">
      <TroubleCard
        testId="not-found"
        heading="We can’t show you that page"
        note="The address may be mistyped, or the link may be out of date. Whatever you can open is waiting on the Power Suite home page."
      />
    </main>
  );
}

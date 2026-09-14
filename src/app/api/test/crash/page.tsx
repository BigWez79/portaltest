import { notFound } from "next/navigation";
import { isTestMode } from "@/lib/env";

/**
 * A page that throws, so the suite can watch src/app/error.tsx catch something.
 *
 * It sits with the session seeder and the sign-in ledger under /api/test for
 * the same reason they do: one prefix for everything that exists only under the
 * suite, which the proxy already knows about and which is a 404 in every
 * environment that is not running the tests. It calls no requireApp because
 * there is nothing behind it to guard — outside test mode there is no page here
 * at all.
 *
 * force-dynamic because a page that throws on render is a page that would throw
 * during prerendering, and take `next build` with it.
 */
export const dynamic = "force-dynamic";

export default async function CrashPage() {
  if (!isTestMode()) notFound();

  throw new Error("deliberate crash — the suite is exercising the error boundary");
}

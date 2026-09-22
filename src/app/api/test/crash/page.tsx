import { notFound } from "next/navigation";
import { isTestMode } from "@/lib/env";

/**
 * Throws, so the suite can see what a crash looks like.
 *
 * `src/app/error.tsx` is the one screen in Power Suite that cannot be reached by
 * asking for it, and an error page nobody has ever rendered is an error page
 * nobody knows the shape of. This is the smallest way to render it for real —
 * the boundary catches a server component that threw, which is the case it
 * exists for.
 *
 * A page rather than a route handler, and under /api/test with the seeder and
 * the ledger, because that prefix is already this app's test-mode namespace:
 * everything under it is 404 outside E2E_TEST_MODE, the proxy already treats it
 * as public, and `npm run check:secrets` fails a production build with the flag
 * baked in. Keeping it there means there is one place to look for test-only
 * surface, not two.
 */
export const dynamic = "force-dynamic";

export default async function CrashPage(): Promise<never> {
  if (!isTestMode()) notFound();

  throw new Error("Deliberate crash, to render the error boundary under test.");
}

import { NextResponse } from "next/server";
import { isTestMode, staffSource } from "@/lib/env";

/**
 * Reads the e2e sign-in ledger, and clears it.
 *
 * The sign-in form deliberately says the same thing whether a link went out or
 * was refused, so a test cannot tell the two apart from the page. This is how
 * it tells: the ledger records the decision the action actually took, at the
 * point it took it.
 *
 * Exists only when E2E_TEST_MODE=1 and STAFF_SOURCE=fixture; in every other
 * environment it is a 404, like the session seeder beside it.
 *
 *   GET /api/test/rate-limit?email=a@b.test   -> { allowed, refused }
 *   GET /api/test/rate-limit?ip=203.0.113.1   -> { allowed, refused }
 *
 * Read only. There is no endpoint that empties the ledger: workers run in
 * parallel, and one spec clearing it mid-run would quietly hand another the
 * wrong count. tests/global-setup.ts deletes .tmp before every run, and the
 * specs that count use an address and an IP of their own.
 */
export const dynamic = "force-dynamic";

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

function available() {
  return isTestMode() && staffSource() === "fixture";
}

export async function GET(request: Request) {
  if (!available()) return notFound();

  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  const ip = url.searchParams.get("ip");
  if (!email && !ip) {
    return NextResponse.json({ error: "email or ip is required" }, { status: 400 });
  }

  const { signInAttemptStore } = await import("@/lib/rate-limit-store");
  const key = email ? `email:${email.toLowerCase()}` : `ip:${ip}`;
  return NextResponse.json({ key, ...(await signInAttemptStore.summary(key)) });
}

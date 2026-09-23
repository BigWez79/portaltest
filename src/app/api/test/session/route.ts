import { NextResponse } from "next/server";
import { E2E_COOKIE } from "@/lib/current-user";
import { isTestMode, staffSource } from "@/lib/env";

/**
 * Plants a fake session for the e2e suite, and resets the fixture staff store
 * between tests that write.
 *
 * Exists only when E2E_TEST_MODE=1; in every other environment it is a 404 and
 * getCurrentUser() ignores the cookie it would set. `npm run check:secrets`
 * fails a production build that has the flag baked in.
 *
 *   GET    /api/test/session?email=a@b.test&name=A%20B
 *   DELETE /api/test/session          sign out
 *   POST   /api/test/session?reset=1          restore every fixture store
 *   POST   /api/test/session?reset=profiles  restore only the ones named
 */
export const dynamic = "force-dynamic";

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

export async function GET(request: Request) {
  if (!isTestMode()) return notFound();

  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const payload = {
    id: `e2e-${email.toLowerCase()}`,
    email: email.toLowerCase(),
    name: url.searchParams.get("name"),
  };

  const response = NextResponse.json({ ok: true, session: payload });
  response.cookies.set(E2E_COOKIE, encodeURIComponent(JSON.stringify(payload)), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}

/**
 * The stores, by the name a test asks for them under.
 *
 * WHY A TEST MAY NAME THEM. The suite runs fully parallel against one server,
 * so every worker shares these files. A spec that resets everything to restore
 * the one store it writes to also throws away whatever the other workers were
 * halfway through — which surfaced as an admin test losing a flag it had just
 * set, from a profile test that had nothing to do with it.
 *
 * Resetting everything is still the default, because a spec that writes to
 * several and names only some is the same bug wearing a hat.
 */
const STORES: Record<string, () => Promise<{ reset: () => Promise<void> }>> = {
  staff: async () => (await import("@/lib/fixture-store")).fixtureStore,
  audit: async () => (await import("@/lib/audit-store")).auditStore,
  expenses: async () => (await import("@/lib/expenses-store")).expenseStore,
  invoices: async () => (await import("@/lib/invoices-store")).invoiceStore,
  timesheets: async () => (await import("@/lib/timesheets-store")).timesheetStore,
  profiles: async () => (await import("@/lib/profile-store")).profileStore,
};

export async function POST(request: Request) {
  if (!isTestMode()) return notFound();
  if (staffSource() !== "fixture") {
    return NextResponse.json({ error: "not using the fixture store" }, { status: 400 });
  }

  const asked = new URL(request.url).searchParams.get("reset") ?? "1";
  const names = asked === "1" || asked === "all" ? Object.keys(STORES) : asked.split(",");

  // A misspelled store name that quietly reset nothing would leave a test
  // passing against whatever the last one wrote.
  const unknown = names.filter((n) => !(n in STORES));
  if (unknown.length > 0) {
    return NextResponse.json({ error: `no such store: ${unknown.join(", ")}` }, { status: 400 });
  }

  await Promise.all(names.map(async (n) => (await STORES[n]()).reset()));
  return NextResponse.json({ ok: true, reset: names });
}

export async function DELETE() {
  if (!isTestMode()) return notFound();
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(E2E_COOKIE);
  return response;
}

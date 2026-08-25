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
 *   POST   /api/test/session?reset=1  restore the fixture staff list
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

export async function POST() {
  if (!isTestMode()) return notFound();
  if (staffSource() !== "fixture") {
    return NextResponse.json({ error: "not using the fixture store" }, { status: 400 });
  }
  const { fixtureStore } = await import("@/lib/fixture-store");
  await fixtureStore.reset();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  if (!isTestMode()) return notFound();
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(E2E_COOKIE);
  return response;
}

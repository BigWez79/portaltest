import { NextResponse } from "next/server";
import { E2E_COOKIE } from "@/lib/current-user";
import { isTestMode } from "@/lib/env";

/**
 * Plants a fake session for the e2e suite. Exists only when E2E_TEST_MODE=1;
 * in every other environment it is a 404 and getCurrentUser() ignores the
 * cookie it would set. `npm run check:secrets` fails the build if the flag is
 * ever baked into a production bundle.
 *
 *   GET  /api/test/session?email=a@b.co.uk&name=A%20B&upn=a@b.co.uk
 *   DELETE /api/test/session
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
    email: email.toLowerCase(),
    upn: (url.searchParams.get("upn") ?? email).toLowerCase(),
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

export async function DELETE() {
  if (!isTestMode()) return notFound();
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(E2E_COOKIE);
  return response;
}

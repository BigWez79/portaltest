import { NextResponse } from "next/server";
import { endSession } from "@/lib/session";
import { SIGNED_OUT_REASON } from "@/lib/signed-out";

/**
 * Ends a session and puts the person back on the sign-in card.
 *
 * A route handler rather than something the portal page does itself, because a
 * server component's cookie jar is read-only: the page can work out that this
 * session should not continue, but only a handler can clear the cookie that
 * makes it continue.
 *
 * Nothing here checks who is calling, and nothing needs to: the only thing it
 * does is take away whatever session the caller arrived with.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await endSession();
  return NextResponse.redirect(
    new URL(`/?error=${SIGNED_OUT_REASON}`, new URL(request.url).origin),
  );
}

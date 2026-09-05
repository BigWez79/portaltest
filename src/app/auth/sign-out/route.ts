import { NextResponse } from "next/server";
import { endSession } from "@/lib/session";

/**
 * Ends the session and sends the browser to the front door.
 *
 * The Sign out button does not come through here — it is a server action, which
 * can clear a cookie on its own. This exists for the case a server component
 * cannot handle itself: the portal finding that whoever holds this session is
 * no longer active staff. A page render cannot write a cookie, so it redirects
 * here, and this clears it.
 *
 * A GET, and therefore forgeable from another site: an <img> pointing at it
 * would sign somebody out. That is the whole of what it can do — there is no
 * state to change and nothing to read — so it is an annoyance rather than a
 * hole, and the alternative (a POST, or a token) needs script on a page that is
 * mid-redirect. Named here so it is a decision rather than an oversight.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cleared = await endSession();

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  for (const name of cleared) response.cookies.delete(name);
  return response;
}

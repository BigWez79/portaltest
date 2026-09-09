import { NextResponse } from "next/server";
import { endSession } from "@/lib/session";

/**
 * Ends the session and puts the person back at the front door.
 *
 * A server component cannot write cookies, so `/` redirects here when it finds
 * the caller has been deactivated. That is the whole reason this is a route and
 * not four lines in a page.
 *
 * It ends whoever is calling — there is no user in the URL to get wrong, and
 * nothing here can be aimed at somebody else's session.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await endSession();
  return NextResponse.redirect(new URL("/", new URL(request.url).origin));
}

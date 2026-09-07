import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { endSession } from "@/lib/session";
import { resolveAccess } from "@/lib/staff";

/**
 * Where the portal sends somebody whose staff row has been deactivated.
 *
 * A route rather than something the page does itself: a server component cannot
 * write a cookie, and ending a session is exactly writing one.
 *
 * It re-checks the caller rather than trusting the redirect that got them here.
 * A GET that signs you out is otherwise a nuisance any page on the internet can
 * fire with an <img> tag; re-reading the staff row means an active person who
 * lands here is redirected home still signed in, and the only session this can
 * end is one that had already lost its access.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (user) {
    const access = await resolveAccess(user);
    if (access.deactivated) {
      console.warn(
        JSON.stringify({ event: "auth.session.ended", reason: "deactivated", email: access.email }),
      );
      await endSession();
    }
  }

  return NextResponse.redirect(new URL("/", request.url));
}

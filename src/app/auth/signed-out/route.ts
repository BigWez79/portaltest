import { NextResponse, type NextRequest } from "next/server";
import { E2E_COOKIE } from "@/lib/current-user";
import { isTestMode } from "@/lib/env";

/**
 * Ends the session of somebody who no longer has an active staff row, and puts
 * them back on the sign-in card.
 *
 * Deactivating somebody already took effect on their next page load — every
 * route reads the staff row fresh, so the tiles vanish and requireApp 404s.
 * What was left was the cookie: they saw a signed-in portal with a no-access
 * notice rather than being signed out, which on the day somebody leaves badly
 * is the wrong signal to send. src/app/page.tsx sends them here instead.
 *
 * A route handler rather than a server component, because this is the only kind
 * of request that can write a cookie back — a page can read the jar and not
 * change it. And a GET, because their next request is one.
 *
 * The sign-out runs as *them*, on their own session: scope "global" revokes
 * every session they hold, on every device, without the service role coming
 * near it. There is no admin call that would do this from the other side —
 * auth.admin.signOut takes the session's own JWT, which the person deactivating
 * them does not have.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // The parameter is what stops a redirect loop: page.tsx renders rather than
  // redirecting again if it still sees a session after this has run.
  const response = NextResponse.redirect(new URL("/?signed_out=1", request.url));

  if (isTestMode()) {
    response.cookies.delete(E2E_COOKIE);
    return response;
  }

  const { supabaseServer } = await import("@/lib/supabase/server");
  const client = await supabaseServer();
  const { error } = await client.auth.signOut({ scope: "global" });

  // Worth seeing, and not worth stopping for: the cookie goes either way, and a
  // revoke that failed leaves a session Supabase still honours until it expires.
  if (error) {
    console.error("[auth] signed-out: revoking the session failed —", error.message);
  }

  // signOut() clears the cookie through the same jar every other Supabase call
  // here writes to. This clears it on the response as well, so the redirect
  // cannot hand back the cookie it was issued to get rid of — the one failure
  // mode that would turn this route into a loop.
  for (const cookie of request.cookies.getAll()) {
    if (/^sb-.*-auth-token(\.\d+)?$/.test(cookie.name)) {
      response.cookies.delete(cookie.name);
    }
  }

  return response;
}

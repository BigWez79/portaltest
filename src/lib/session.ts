import "server-only";
import { cookies } from "next/headers";
import { E2E_COOKIE } from "./current-user";
import { isTestMode } from "./env";

/**
 * Ending a session, in the one place that knows how.
 *
 * Two callers: the Sign out button, and the portal when it finds the person
 * holding the session is no longer active staff. Both want the same thing —
 * the session gone rather than merely useless — and a second implementation of
 * that is a second thing to get wrong.
 */

/**
 * The cookies a session is carried in.
 *
 * Supabase's is `sb-<project-ref>-auth-token`, and is split into
 * `…auth-token.0`, `…auth-token.1` when it outgrows one cookie, so this matches
 * on the stem rather than the whole name.
 */
const isSessionCookie = (name: string) =>
  name === E2E_COOKIE || (name.startsWith("sb-") && name.includes("auth-token"));

/**
 * Signs the caller out and clears the cookies that carried the session.
 *
 * `scope: "global"` — every session this person has, not just this browser.
 * The Sign out button has always been global (it is supabase-js's default) and
 * the deactivation path wants it for a better reason: somebody who has left
 * should not still be signed in on a phone.
 *
 * Returns the names of the cookies it found, so a route handler can clear them
 * on its own response too. That is not belt and braces for its own sake: a
 * redirect built with NextResponse is a different object from the request's
 * cookie jar, and if the browser kept the cookie, the page that redirected here
 * would redirect here again. A sign-out that loops is worse than none.
 */
export async function endSession(): Promise<string[]> {
  const jar = await cookies();
  const carried = jar
    .getAll()
    .map((c) => c.name)
    .filter(isSessionCookie);

  if (!isTestMode()) {
    const { supabaseServer } = await import("./supabase/server");
    const client = await supabaseServer();
    // The caller's own session revokes itself. No service role: an ordinary
    // sign-out is a thing a person is allowed to do to themselves.
    const { error } = await client.auth.signOut({ scope: "global" });
    // Logged, not thrown. If Supabase cannot be reached the refresh token
    // outlives this request, but the cookies below still go — the session ends
    // on this device either way, which is the part the person can see.
    if (error) console.error("[auth] sign out failed —", error.message);
  }

  for (const name of carried) {
    try {
      jar.delete(name);
    } catch {
      // Read-only jar. Only a route handler or a server action calls this, so
      // this is not expected — and the returned names cover it if it happens.
    }
  }

  return carried;
}

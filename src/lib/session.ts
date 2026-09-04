import "server-only";
import { cookies } from "next/headers";
import { E2E_COOKIE } from "./current-user";
import { isTestMode } from "./env";

/**
 * Supabase's session cookie, and the chunks it is split into when it is too
 * big for one. The project reference is in the middle of the name, so it is
 * matched rather than spelled out — a redeploy against a different project
 * would otherwise leave the old cookie sitting there.
 */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * Ends the caller's session — here and on every other device.
 *
 * `scope: "global"` revokes every refresh token the person holds, so a session
 * on another machine dies at its next refresh rather than running for another
 * hour. That is the effect `auth.admin.signOut(jwt, "global")` has, reached
 * without the service role: the admin API needs the *target's* JWT, which an
 * admin does not have, and this runs on a request that carries it.
 *
 * Then the cookies go, because revoking the refresh token is not visible until
 * something tries to use it — and a browser still holding a session cookie
 * still renders as signed in until the access token expires.
 *
 * Callable from a server action or a route handler only. A server component's
 * cookie jar is read-only and this would throw.
 */
export async function endSession(): Promise<void> {
  const jar = await cookies();

  if (isTestMode()) {
    jar.delete(E2E_COOKIE);
    return;
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { error } = await client.auth.signOut({ scope: "global" });

  // Worth saying out loud. The cookies are cleared either way, so the person
  // is signed out of this browser regardless; what a failure here costs is the
  // revocation on their other devices.
  if (error) console.error("[auth] global sign-out failed —", error.message);

  for (const cookie of jar.getAll()) {
    if (AUTH_COOKIE.test(cookie.name)) jar.delete(cookie.name);
  }
}

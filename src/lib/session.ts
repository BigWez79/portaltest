import "server-only";
import { cookies } from "next/headers";
import { E2E_COOKIE } from "./current-user";
import { isTestMode } from "./env";

/**
 * Ends the caller's session — this browser and every other one.
 *
 * One function, because there are now two reasons to end a session: the Sign out
 * button, and the portal finding that the person looking at it has been
 * deactivated. Both must clear the same cookie in the same way, and the test
 * branch below is the half that was previously missing from the button.
 *
 * WHY THE CALLER'S OWN SESSION AND NOT THE SERVICE ROLE.
 *
 * The obvious shape is for the admin screen to revoke the session at the moment
 * `active` goes false — `auth.admin.signOut(...)`. Two things stop that:
 *
 *   1. CLAUDE.md allows the service role exactly twice, and neither is this.
 *   2. `auth.admin.signOut(jwt, scope)` in @supabase/auth-js takes the target's
 *      *access token*, not their user id. An admin deactivating somebody else
 *      does not have it, and GoTrue exposes no revoke-by-user-id endpoint.
 *
 * So the revocation happens on the deactivated person's own next request, with
 * their own session, using the anon key: `scope: "global"` revokes every refresh
 * token they hold, so one visit from one device signs them out of all of them.
 *
 * What that leaves: between the flag being flipped and their next visit, their
 * refresh token still works against Supabase directly. It buys nothing — it
 * carries the `authenticated` role, RLS reads their own inactive row, and
 * `is_admin()` is false — but it is true, and worth writing down rather than
 * implying an instant kill.
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

  // auth-js returns early on a failed revoke and leaves the local session in
  // place. The cookie has to go regardless: the portal redirects a deactivated
  // person here, so a cookie that survives is a redirect loop rather than an
  // inconvenience. Supabase's session cookie is `sb-<ref>-auth-token`, and is
  // chunked into `.0`, `.1`, … once it outgrows the 4KB limit.
  if (error) {
    console.error("[auth] global sign-out failed —", error.message);
    for (const { name } of jar.getAll()) {
      if (/^sb-.*auth-token/.test(name)) jar.delete(name);
    }
  }
}

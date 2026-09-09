import "server-only";
import { cookies } from "next/headers";
import { E2E_COOKIE } from "./current-user";
import { isTestMode } from "./env";

/**
 * Supabase's session cookie, and the chunks it splits into when the token is
 * too long for one: `sb-<ref>-auth-token`, `sb-<ref>-auth-token.0`, `.1`.
 * @supabase/ssr names them from the project ref, so the prefix is all this side
 * can know.
 */
const isSessionCookie = (name: string) =>
  name === E2E_COOKIE || (name.startsWith("sb-") && name.includes("-auth-token"));

/**
 * Ends the caller's session — on every device, not just in this browser.
 *
 * Callable only from a Server Action or a Route Handler: those are the two
 * places the cookie jar is writable. A server component that wants this
 * redirects to /auth/signed-out instead.
 */
export async function endSession(): Promise<void> {
  if (!isTestMode()) {
    const { supabaseServer } = await import("./supabase/server");
    const client = await supabaseServer();

    // "global" revokes every refresh token this person holds, so a session left
    // open on a phone goes with the one being used here. Their access token
    // stays valid until it expires, which is the same either way — what stops
    // them meanwhile is that every route reads the staff row fresh.
    const { error } = await client.auth.signOut({ scope: "global" });

    // Logged, not thrown. Failing to reach Supabase must not leave somebody
    // holding a session cookie this app is unwilling to end: the cookies go
    // below whatever happened here.
    if (error) console.error("[auth] sign-out failed —", error.message);
  }

  // Cleared here as well as by the Supabase client, which clears them itself on
  // a successful sign-out and not at all otherwise. `/` sends a deactivated
  // person to /auth/signed-out, so a session cookie that survives this is not an
  // untidy portal — it is that redirect, over and over.
  const jar = await cookies();
  for (const { name } of jar.getAll()) {
    if (isSessionCookie(name)) jar.delete(name);
  }
}

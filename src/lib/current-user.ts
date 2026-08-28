import "server-only";
import { cookies } from "next/headers";
import { isTestMode } from "./env";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
};

export const E2E_COOKIE = "e2e-session";

/**
 * The one place the app asks "who is this".
 *
 * Under the e2e suite (E2E_TEST_MODE=1) the answer comes from a cookie planted
 * by /api/test/session, so the suite never sends an email or reaches Supabase.
 * Everywhere else it is the Supabase session, and the test branch is
 * unreachable: the seeder route 404s and this function ignores the cookie.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (isTestMode()) {
    const jar = await cookies();
    const raw = jar.get(E2E_COOKIE)?.value;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<CurrentUser>;
      if (!parsed.email) return null;
      return {
        id: parsed.id ?? `e2e-${parsed.email}`,
        email: parsed.email.toLowerCase(),
        name: parsed.name ?? null,
      };
    } catch {
      return null;
    }
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  // getUser() revalidates the token with Supabase rather than trusting the
  // cookie's contents. Slower than reading the session, and the right default.
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  // The error used to be destructured away, which made every failure look
  // identical to "nobody is signed in" — a bad session, an unreachable Supabase
  // and a genuinely signed-out visitor all rendered the same sign-in card with
  // nothing in the log.
  //
  // That cost a diagnosis on 2026-08-27: a session Supabase itself accepted
  // (its access token returned the right user against /auth/v1/user) came back
  // empty here on Vercel while working locally, and there was no way to see why
  // from the outside. "No session" is not an error and stays quiet; anything
  // else is now visible to whoever is reading the runtime log.
  if (error && !/session|not authenticated|missing/i.test(error.message)) {
    console.error("[auth] getUser failed —", error.message);
  }

  if (!user?.email) return null;

  return {
    id: user.id,
    email: user.email.toLowerCase(),
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
  };
}

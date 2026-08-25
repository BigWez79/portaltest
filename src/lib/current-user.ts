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
  } = await client.auth.getUser();

  if (!user?.email) return null;

  return {
    id: user.id,
    email: user.email.toLowerCase(),
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
  };
}

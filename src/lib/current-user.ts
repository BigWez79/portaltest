import "server-only";
import { cookies } from "next/headers";
import { isTestMode } from "./env";

export type CurrentUser = {
  email: string;
  upn: string | null;
  name: string | null;
};

export const E2E_COOKIE = "e2e-session";

/**
 * The one place the app asks "who is this".
 *
 * Under the e2e suite (E2E_TEST_MODE=1) the answer comes from a cookie planted
 * by /api/test/session, so the suite never touches Entra — Entra will not
 * accept a wildcard redirect URI and Vercel preview hostnames change on every
 * push. Everywhere else it is the real Auth.js session, and the test branch is
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
        email: parsed.email.toLowerCase(),
        upn: parsed.upn ? parsed.upn.toLowerCase() : null,
        name: parsed.name ?? null,
      };
    } catch {
      return null;
    }
  }

  const { auth } = await import("@/auth");
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  return {
    email: email.toLowerCase(),
    upn: session.user.upn ?? null,
    name: session.user.name ?? null,
  };
}

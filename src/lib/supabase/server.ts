import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { sessionCookieDomain, supabase as env } from "../env";

/**
 * The request-scoped client. Uses the anon key and the caller's session cookie,
 * so every read is subject to row level security — a staff member can see their
 * own row and nothing else, and that is enforced by Postgres rather than by this
 * codebase remembering to filter.
 *
 * The cookie is scoped to SESSION_COOKIE_DOMAIN (.poweranalytix.co.uk in
 * production) so one sign-in covers the portal and all three apps.
 */
export async function supabaseServer() {
  const jar = await cookies();
  const domain = sessionCookieDomain();

  return createServerClient(env.url, env.anonKey, {
    cookieOptions: {
      domain,
      sameSite: "lax",
      secure: domain !== undefined,
      path: "/",
    },
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of toSet) {
            jar.set(name, value, options);
          }
        } catch {
          // Called from a server component, where the cookie jar is read-only.
          // middleware.ts refreshes the session, so this is safe to swallow.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Two callers only: inviting a person (auth.admin.inviteUserByEmail) and the
 * one-off CSV import. It is never used to read staff rows for a page — that
 * would throw away the protection RLS is there to give.
 */
export function supabaseAdmin() {
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

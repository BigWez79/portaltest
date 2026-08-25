import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { supabase as env } from "../env";

/**
 * The request-scoped client. Uses the anon key and the caller's session cookie,
 * so every read is subject to row level security — a staff member can see their
 * own row and nothing else, and that is enforced by Postgres rather than by this
 * codebase remembering to filter.
 *
 * The cookie is host-only. All four apps are routes in this one deployment, so
 * there is no session shared across origins to get wrong.
 */
export async function supabaseServer() {
  const jar = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookieOptions: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
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

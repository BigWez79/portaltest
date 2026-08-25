import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js calls this on every request. It was `middleware.ts` until Next 16
 * renamed the convention to `proxy`; the job is unchanged.
 *
 * Refreshes the Supabase session cookie, so a signed-in person
 * is not thrown out mid-session when the access token expires.
 *
 * It does not decide *which* app somebody may open — requireApp does that, per
 * route, from the staff row. This only keeps the session alive and sends
 * signed-out traffic to the front door, so a route added later is behind a
 * sign-in before anyone remembers to put it there.
 */
const PUBLIC_PATHS = ["/", "/auth/callback", "/api/test/session"];

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (process.env.E2E_TEST_MODE === "1") {
    if (!isPublic && !request.cookies.get("e2e-session")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return response;
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookieOptions: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const target = new URL("/", request.url);
    target.searchParams.set("next", pathname);
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.woff2$).*)"],
};

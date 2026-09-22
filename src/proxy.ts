import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";

/**
 * Next.js calls this on every request. It was `middleware.ts` until Next 16
 * renamed the convention to `proxy`; the job is unchanged.
 *
 * Refreshes the Supabase session cookie, so a signed-in person
 * is not thrown out mid-session when the access token expires.
 *
 * It also issues the request's CSP nonce. That has to happen here and not in a
 * page, because the header has to be on the request before Next renders — Next
 * reads the nonce back out of it to stamp its own inline scripts.
 *
 * It does not decide *which* app somebody may open — requireApp does that, per
 * route, from the staff row. This only keeps the session alive and sends
 * signed-out traffic to the front door, so a route added later is behind a
 * sign-in before anyone remembers to put it there.
 */
// `/api/test` covers the session seeder and the sign-in ledger the suite reads.
// Both are signed-out concerns, and both 404 outside test mode, so nothing is
// exposed by naming the prefix rather than each route.
//
// `/auth/sign-out` is public for the same reason `/auth/callback` is: it is
// about not having a session. Bouncing a request for it to the front door
// because the session it was going to clear has already gone would be a loop
// with extra steps.
const PUBLIC_PATHS = ["/", "/auth/callback", "/auth/sign-out", "/api/test"];

export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce);

  // The header goes on the request as well as the response. The response one is
  // what the browser enforces; the request one is what Next reads the nonce out
  // of when it renders. Set only the response header and the page is served
  // under a policy that blocks the page's own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  // Every way out of this function, redirects included — a redirect that
  // renders nothing still deserves the header, and forgetting one is exactly
  // how a policy ends up covering everything except the interesting case.
  const sealed = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  const response = sealed(NextResponse.next({ request: { headers: requestHeaders } }));
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (process.env.E2E_TEST_MODE === "1") {
    if (!isPublic && !request.cookies.get("e2e-session")) {
      return sealed(NextResponse.redirect(new URL("/", request.url)));
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
    error,
  } = await supabase.auth.getUser();

  // A failure to *ask* is not the same as an answer of "nobody", and treating
  // the two alike is how a signed-in person gets bounced to the front door with
  // no trace of why. On 2026-08-27 this redirected every guarded route on Vercel
  // — /admin and /margin both 307 to /?next=… — while the identical commit and
  // the identical cookie signed in fine against a local production build. The
  // log said nothing, because there was nothing to say it with.
  //
  // So: log it, and let the request through. The page behind it calls getUser
  // itself and requireApp still gates on the staff row, so nothing is opened up
  // by declining to guess here — the guard is re-checked where it matters.
  if (error && !/session|not authenticated|missing/i.test(error.message)) {
    console.error(`[proxy] getUser failed on ${pathname} —`, error.message);
    return response;
  }

  if (!user && !isPublic) {
    const target = new URL("/", request.url);
    target.searchParams.set("next", pathname);
    return sealed(NextResponse.redirect(target));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.woff2$).*)"],
};

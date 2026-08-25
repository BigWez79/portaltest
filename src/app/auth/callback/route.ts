import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isTestMode } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where a magic link lands.
 *
 * The link carries a token_hash, which is exchanged for a session here, on the
 * server. Nothing about the session is ever handled in the browser — which is
 * the whole reason this route exists rather than letting Supabase's own
 * /auth/v1/verify endpoint finish the job.
 *
 * That choice only works if the email templates cooperate, and by default they
 * do not. Supabase ships templates built on {{ .ConfirmationURL }}, which is
 *
 *   https://<ref>.supabase.co/auth/v1/verify?token=…&type=…&redirect_to=…
 *
 * Supabase verifies that itself and redirects to redirect_to with the session
 * in the URL *fragment*, which only client-side JavaScript can read. This route
 * would then see no token_hash and bounce the person to /?error=link, and the
 * session would be sitting in the address bar of a page that never reads it.
 *
 * So the templates are the side that changes. They are in
 * supabase/email-templates/, they are pasted in by a person (BLOCKED.md: email
 * templates are a project setting), and they point here with {{ .TokenHash }}.
 *
 * The alternative — accepting Supabase's PKCE `?code=` redirect and calling
 * exchangeCodeForSession — is also server-side and was considered. It loses on
 * one point that matters for a staff portal: PKCE needs the code-verifier
 * cookie set by the browser that *asked* for the link, so a link requested on a
 * laptop and opened on a phone fails. token_hash works across devices, which is
 * how people actually read email.
 *
 * Supabase accepts wildcard redirect URLs, so every Vercel preview can complete
 * a real sign-in — which is why the templates build the link from
 * {{ .RedirectTo }} (what the app passed as emailRedirectTo) rather than
 * hard-coding a host.
 */
export const dynamic = "force-dynamic";

/**
 * The types verifyOtp will accept from an email link. Checked rather than cast:
 * a template with the wrong type is a plausible mistake and its symptom
 * otherwise looks identical to an expired link.
 */
const EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const satisfies readonly EmailOtpType[];

const isEmailOtpType = (v: string | null): v is EmailOtpType =>
  v !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(v);

const bounce = (origin: string) => NextResponse.redirect(new URL("/?error=link", origin));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = url.searchParams.get("next");

  // Only ever redirect within this site. An open redirect on a sign-in callback
  // is how a link that looks legitimate lands somebody somewhere else.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (isTestMode()) return bounce(url.origin);

  // Supabase's own /auth/v1/verify reports its failures this way — an expired
  // or already-used link arrives here as an error param, not as a bad token.
  const supabaseError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (supabaseError) {
    console.error("[auth] callback: supabase rejected the link —", supabaseError);
    return bounce(url.origin);
  }

  if (!tokenHash) {
    // Almost always the template, not the link. Say so, because the symptom on
    // its own — "the magic link just goes back to the sign-in page" — sent one
    // session looking in the wrong place entirely.
    console.error(
      "[auth] callback: no token_hash. The email template is probably still on " +
        "{{ .ConfirmationURL }}, which verifies at Supabase and returns the session " +
        "in a URL fragment this route cannot see. See supabase/email-templates/.",
    );
    return bounce(url.origin);
  }

  if (!isEmailOtpType(type)) {
    console.error(
      `[auth] callback: type=${JSON.stringify(type)} is not a valid email OTP type. ` +
        `A magic link is type=magiclink and an invite is type=invite; the template sets it.`,
    );
    return bounce(url.origin);
  }

  const client = await supabaseServer();
  const { error } = await client.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    console.error(`[auth] callback: verifyOtp(type=${type}) failed —`, error.message);
    return bounce(url.origin);
  }

  return NextResponse.redirect(new URL(destination, url.origin));
}

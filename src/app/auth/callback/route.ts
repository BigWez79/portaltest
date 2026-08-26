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
 * TWO WAYS IN, because the email that actually gets sent decides which.
 *
 * `?code=`  — what the stock templates produce, and therefore what happens
 *             today. Supabase's {{ .ConfirmationURL }} points at its own
 *             /auth/v1/verify, which verifies and then redirects here.
 *             @supabase/ssr hard-codes flowType: "pkce", so that redirect
 *             carries a code rather than a fragment, and exchangeCodeForSession
 *             finishes the job — on the server, which is what matters.
 *
 * `token_hash` — what a custom template produces, via {{ .TokenHash }}. Kept
 *             ready for when it can be used.
 *
 * The templates in supabase/email-templates/ are the better answer and cannot
 * currently be applied: Supabase does not allow template edits on the built-in
 * email service, only with custom SMTP. Pointing SMTP at Resend is a person's
 * job (BLOCKED.md) and is not done. So the code moved instead. When SMTP lands,
 * paste the templates and the token_hash branch below takes over with no
 * further change here.
 *
 * That order of preference is not arbitrary. PKCE needs the code-verifier
 * cookie set by the browser that *asked* for the link, so:
 *
 *   request on a laptop, open on a laptop  -> works
 *   request on a laptop, open on a phone   -> fails, and always will
 *
 * token_hash has no such constraint. Until the templates can be applied, that
 * cross-device case is broken and no amount of code here fixes it — the log
 * below names it rather than leaving it to be guessed at.
 *
 * Either way nothing about the session is handled in the browser, which is the
 * point of this route existing at all.
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
  const code = url.searchParams.get("code");
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

  // The PKCE code, which is what the stock templates deliver. Checked first
  // because it is what actually arrives today.
  if (code) {
    const client = await supabaseServer();
    const { error } = await client.auth.exchangeCodeForSession(code);

    if (error) {
      console.error(
        `[auth] callback: exchangeCodeForSession failed — ${error.message}. ` +
          `If this says the verifier is missing, the link was opened in a different ` +
          `browser from the one that asked for it; PKCE cannot do that. A custom ` +
          `email template using {{ .TokenHash }} can — see supabase/email-templates/.`,
      );
      return bounce(url.origin);
    }

    return NextResponse.redirect(new URL(destination, url.origin));
  }

  if (!tokenHash) {
    console.error(
      "[auth] callback: neither code nor token_hash. Nothing usable arrived — " +
        "check what the email link actually points at.",
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

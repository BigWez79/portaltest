import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isTestMode } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where a magic link lands.
 *
 * The link carries a token_hash, which is exchanged for a session here, on the
 * server. Nothing about the session is ever handled in the browser.
 *
 * Supabase accepts wildcard redirect URLs, so every Vercel preview can complete
 * a real sign-in — unlike the Entra version, which could not.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
  const next = url.searchParams.get("next");

  // Only ever redirect within this site. An open redirect on a sign-in callback
  // is how a link that looks legitimate lands somebody somewhere else.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (isTestMode() || !tokenHash) {
    return NextResponse.redirect(new URL("/?error=link", url.origin));
  }

  const client = await supabaseServer();
  const { error } = await client.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    console.error("[auth] callback failed", error.message);
    return NextResponse.redirect(new URL("/?error=link", url.origin));
  }

  return NextResponse.redirect(new URL(destination, url.origin));
}

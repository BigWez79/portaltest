"use server";

import { redirect } from "next/navigation";
import { isTestMode, siteUrl } from "@/lib/env";
import { consumeSignInAttempt } from "@/lib/rate-limit";

export type SignInState = { status: "idle" | "sent" | "error"; message?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends a magic link.
 *
 * `shouldCreateUser: false` means this form never creates an account, so an
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  });

  // Logged, never returned. The operator finds out; the browser does not.
  //
  // This used to swallow two specific messages, "user not found" and "signups
  // not allowed", and surface everything else as "we could not send the link".
  // On 2026-08-25 that was demonstrated against staging to be a staff
  // directory, needing two requests per address:
  //
  //   unknown address, twice  ->  "Check your email", "Check your email"
  //   known address, twice    ->  "Check your email", "We could not send the link"
  //
  // An unknown address short-circuits on user-not-found and never reaches the
  // send path. A known one does, and hits GoTrue's own per-address limit, which
  // did not match the filter and so came back to the browser. The rate limiter
  // above is neutral for exactly this reason; leaving this branch in place
  // would have reintroduced the leak one line below the comment explaining it.
  if (error) {
    console.error("[auth] magic link not sent", error.message);
  }

  return sent;
 */
export async function requestMagicLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!EMAIL.test(email)) {
    return { status: "error", message: "That does not look like an email address." };
  }

  // Neutral either way. "You have asked too often" tells somebody holding a
  // list of addresses which ones are worth holding on to, which is the same
  // leak as answering an unknown address differently.
  const sent = { status: "sent" } as const;

  if (!(await consumeSignInAttempt(email))) {
    console.warn(JSON.stringify({ event: "auth.magiclink.rate_limited", email }));
    return sent;
  }

  if (isTestMode()) {
    return sent;
  }

  const { supabaseServer } = await import("@/lib/supabase/server");
  const client = await supabaseServer();

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  });

  // Logged, never returned. The operator finds out; the browser does not.
  if (error) {
    console.error("[auth] magic link not sent", error.message);
  }

  return sent;
}

export async function signOut() {
  if (!isTestMode()) {
    const { supabaseServer } = await import("@/lib/supabase/server");
    const client = await supabaseServer();
    await client.auth.signOut();
  }
  redirect("/");
}

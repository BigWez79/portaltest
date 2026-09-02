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
 * address that is not already a user gets no link. The response to the person
 * is the same either way — telling a stranger "you are not staff" is a
 * directory of who is.
 *
 * That is the belt. The braces are email signups being disabled on the Supabase
 * project itself, which is what stops somebody bypassing this form and asking
 * GoTrue directly.
 *
 * This comment used to assert both were in place. On 2026-08-25 portal-staging
 * was found with `disable_signup: false` — the comment had been wrong for as
 * long as the project had existed, and nothing could have told us: the suite
 * runs on fixtures and reaches no live project, so `npm run verify` was green
 * throughout. `deploy/check-auth-config.sh` is what checks it now. Run it
 * against a project before believing the second sentence.
 *
 * Rate limited per address and per IP before any of that happens: pressing the
 * button again is free, and the cost lands in somebody else's inbox. A refused
 * request is answered exactly as a sent one is — see `src/lib/rate-limit.ts`.
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

  if (error && !/user not found|signups not allowed/i.test(error.message)) {
    console.error("[auth] magic link failed", error.message);
    return {
      status: "error",
      message: "We could not send the link just now. Try again in a moment.",
    };
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

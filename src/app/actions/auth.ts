"use server";

import { redirect } from "next/navigation";
import { isTestMode, siteUrl } from "@/lib/env";

export type SignInState = { status: "idle" | "sent" | "error"; message?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends a magic link.
 *
 * shouldCreateUser is false and email signups are off in the Supabase project,
 * so an address that is not on the staff list gets no link. The response to the
 * person is the same either way — telling a stranger "you are not staff" is a
 * directory of who is.
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

  if (isTestMode()) {
    return { status: "sent" };
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

  return { status: "sent" };
}

export async function signOut() {
  if (!isTestMode()) {
    const { supabaseServer } = await import("@/lib/supabase/server");
    const client = await supabaseServer();
    await client.auth.signOut();
  }
  redirect("/");
}

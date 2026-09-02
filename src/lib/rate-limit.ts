import "server-only";
import { headers } from "next/headers";
import { staffSource } from "./env";

/**
 * How many sign-in links one address, and one address's network, may ask for.
 *
 * Mirrored in supabase/migrations/0002_signin_rate_limit.sql, which is what a
 * deployed portal enforces — the numbers live in SQL there so that the limit is
 * not something an API caller gets to choose. These are the same numbers, used
 * by the file-backed store the e2e suite runs against. Change both.
 *
 * The per-IP window is much looser than the per-address one: staff behind one
 * office NAT share an address, and a refusal is silent, so a tight IP limit
 * would lock colleagues out of the portal without telling anybody why.
 */
export const SIGNIN_LIMITS = {
  perEmail: { limit: 5, windowMs: 60_000 },
  perIp: { limit: 20, windowMs: 15 * 60_000 },
} as const;

/**
 * The caller's address, as far as it can be believed.
 *
 * `x-vercel-forwarded-for` and `x-real-ip` are set by the platform in front of
 * this app and overwrite whatever the client sent, so they are checked first.
 * `x-forwarded-for` is a fallback for another host, and only its first entry —
 * the rest is whatever the chain appended.
 *
 * Null when there is nothing to trust: locally, or behind a proxy that forwards
 * none of these. The per-address limit still applies.
 */
export function ipFromHeaders(source: Headers): string | null {
  const platform = source.get("x-vercel-forwarded-for") ?? source.get("x-real-ip");
  const raw = platform ?? source.get("x-forwarded-for");
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first === "" ? null : first;
}

/**
 * Records a request for a sign-in link and answers whether to send one.
 *
 * Called before the link goes out, and before the test-mode short circuit, so
 * the suite exercises the same decision a deployed portal makes.
 *
 * Fails open. If the ledger cannot be reached the link is sent: this is
 * anti-abuse, not the thing that decides who may sign in, and a portal that
 * turns everybody away because one table is unavailable is the worse failure.
 * Supabase Auth's own limits are still underneath it.
 */
export async function consumeSignInAttempt(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;

  const ip = ipFromHeaders(await headers());

  if (staffSource() === "fixture") {
    const { signInAttemptStore } = await import("./rate-limit-store");
    return signInAttemptStore.consume(address, ip);
  }

  try {
    const { supabaseServer } = await import("./supabase/server");
    const client = await supabaseServer();

    const { data, error } = await client.rpc("consume_signin_attempt", {
      p_email: address,
      p_ip: ip,
    });

    if (error) {
      console.error("[auth] sign-in rate limit unavailable", error.message);
      return true;
    }
    return data !== false;
  } catch (err) {
    console.error(
      "[auth] sign-in rate limit unavailable",
      err instanceof Error ? err.message : String(err),
    );
    return true;
  }
}

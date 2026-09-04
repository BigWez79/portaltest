import { redirect } from "next/navigation";
import { Portal } from "@/components/Portal";
import { SignInCard } from "@/components/SignInCard";
import { getCurrentUser } from "@/lib/current-user";
import { SIGNED_OUT_PATH, SIGNED_OUT_REASON } from "@/lib/signed-out";
import { resolveAccess } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  const { error } = await searchParams;

  if (!user) {
    return (
      <main className="shell gated">
        <SignInCard error={error} />
      </main>
    );
  }

  const access = await resolveAccess(user);

  // Signed in, with no active staff row: deactivated, or never on the list.
  //
  // Deactivation already takes effect on the next page load — every route reads
  // the staff row fresh, so the tiles go and requireApp 404s. What was left was
  // the session itself, which stayed valid, so somebody who had just been taken
  // off the staff list saw a signed-in portal with a notice in it. Ending the
  // session says the true thing instead.
  //
  // The second branch is a loop-breaker, not a fallback: if /auth/signed-out
  // ever failed to clear the cookie, redirecting again would bounce this person
  // between two URLs forever. They see the sign-in card either way — and the
  // suite asserts on the cookie as well as on the card, so a session that
  // survived cannot pass as one that ended.
  if (!access.isStaff) {
    if (error !== SIGNED_OUT_REASON) redirect(SIGNED_OUT_PATH);
    return (
      <main className="shell gated">
        <SignInCard error={SIGNED_OUT_REASON} />
      </main>
    );
  }

  return (
    <main className="shell">
      <Portal access={access} />
    </main>
  );
}

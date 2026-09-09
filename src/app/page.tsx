import { redirect } from "next/navigation";
import { Portal } from "@/components/Portal";
import { SignInCard } from "@/components/SignInCard";
import { getCurrentUser } from "@/lib/current-user";
import { resolveAccess } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    const { error } = await searchParams;
    return (
      <main className="shell gated">
        <SignInCard error={error} />
      </main>
    );
  }

  const access = await resolveAccess(user);

  // Deactivating somebody already takes effect on their next page load — every
  // route reads the staff row fresh, so the tiles have gone and requireApp
  // 404s. What was left was their session: they saw a signed-in portal with a
  // no-access notice, which on the day somebody leaves badly is the wrong
  // signal. So the session ends here, at their next request.
  //
  // Only for a row that says inactive. Somebody signed in with no staff row at
  // all is a different thing — an import that has not run, or an address that
  // did not match — and bouncing them to the sign-in card with no explanation
  // would hide it. They get the notice below, and the staff.lookup.miss warning
  // in the log.
  if (access.deactivated) redirect("/auth/signed-out");

  return (
    <main className="shell">
      <Portal access={access} />
    </main>
  );
}

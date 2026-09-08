import { redirect } from "next/navigation";
import { Portal } from "@/components/Portal";
import { SignInCard } from "@/components/SignInCard";
import { getCurrentUser } from "@/lib/current-user";
import { resolveAccess } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signed_out?: string }>;
}) {
  const user = await getCurrentUser();
  const { error, signed_out: signedOut } = await searchParams;

  if (!user) {
    return (
      <main className="shell gated">
        <SignInCard error={error} signedOut={signedOut === "1"} />
      </main>
    );
  }

  const access = await resolveAccess(user);

  // No active staff row — deactivated, or never on the list. Their session is
  // ended rather than left running behind a no-access notice; /auth/signed-out
  // is the request that can clear the cookie and revoke the session, and it
  // sends them back here signed out.
  //
  // A bootstrap admin has no row by design and is never sent there: isStaff is
  // true for them, which is what stops the portal locking its own administrator
  // out during an import.
  //
  // Not if they have just come back from it. A session that survived that route
  // would otherwise bounce between the two for ever; the portal below, with no
  // tiles in it, is the honest thing to show instead.
  if (!access.isStaff && signedOut !== "1") {
    redirect("/auth/signed-out");
  }

  return (
    <main className="shell">
      <Portal access={access} />
    </main>
  );
}

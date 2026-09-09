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

  // Deactivating somebody already took their access away — every route reads
  // the staff row fresh, so the tiles are gone and requireApp 404s. What was
  // left was the session: they saw a signed-in portal carrying a notice saying
  // they may not use it, which on the day somebody leaves badly is the wrong
  // thing to show them. A server component cannot clear a cookie, so the route
  // that can does it and sends them back here signed out.
  if (access.deactivated) redirect("/auth/sign-out");

  return (
    <main className="shell">
      <Portal access={access} />
    </main>
  );
}

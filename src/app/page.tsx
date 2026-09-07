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

  // Deactivated: every route already 404s for them and no tile renders, so this
  // is not what stops them opening anything — /auth/end-session is what stops
  // them sitting on a signed-in page. Somebody who has been turned off should be
  // signed out, not shown a portal with a notice where their apps used to be.
  //
  // Only for a row that says inactive. Somebody with no row at all is an absence
  // rather than a decision — during the CSV import it is every one of them — and
  // signing them out would loop them through the sign-in form with no
  // explanation. They keep the notice.
  if (access.deactivated) redirect("/auth/end-session");

  return (
    <main className="shell">
      <Portal access={access} />
    </main>
  );
}

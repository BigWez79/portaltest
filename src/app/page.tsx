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

  return (
    <main className="shell">
      <Portal access={access} />
    </main>
  );
}

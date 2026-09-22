import { AppShell } from "@/components/AppShell";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { requireApp } from "@/lib/guard";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Profile — Power Suite" };

/**
 * The sixth app folded in, and the only one with no flag — every active staff
 * member has it (CLAUDE.md rule 10). `requireApp("profile")` still guards the
 * route; what it checks is an active staff row rather than a column.
 *
 * This page matters beyond itself: Invoices stamps these details onto every
 * invoice it raises, so a blank profile is an invoice a customer cannot pay
 * from. The readiness panel at the top says which fields are still missing,
 * rather than leaving somebody to find out after the document has gone.
 */
export default async function ProfilePage() {
  const access = await requireApp("profile");
  const profile = await getProfile(access.email);

  return (
    <AppShell access={access} current="profile" title="My Profile" wide>
      <ProfileForm profile={profile} email={access.email} />
    </AppShell>
  );
}

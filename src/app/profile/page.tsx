import { PortedAppNotice } from "@/components/PortedAppNotice";
import { AppShell } from "@/components/AppShell";
import { requireApp } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Profile — Power Analytix" };

export default async function ProfilePage() {
  const access = await requireApp("profile");

  return (
    <AppShell access={access} current="profile" title="My Profile">
      <PortedAppNotice app="My Profile" blurb="your details, rates and defaults" />
    </AppShell>
  );
}

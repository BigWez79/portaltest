import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InviteForm } from "@/components/admin/InviteForm";
import { StaffTable } from "@/components/admin/StaffTable";
import { getCurrentUser } from "@/lib/current-user";
import { resolveAccess } from "@/lib/staff";
import { listStaff } from "@/lib/staff-admin";

export const dynamic = "force-dynamic";

export const metadata = { title: "Staff access — Power Analytix" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  // notFound() rather than a redirect or a 403: a person who is not an admin
  // learns nothing about whether this route exists.
  if (!user) notFound();

  const access = await resolveAccess(user);
  if (!access.isAdmin) notFound();

  const staff = await listStaff();
  const counts = {
    active: staff.filter((s) => s.active).length,
    admins: staff.filter((s) => s.active && s.isAdmin).length,
    pending: staff.filter((s) => !s.lastSeenAt && s.invitedAt).length,
  };

  return (
    <main className="shell admin-shell">
      <div className="admin-wrap">
        <header>
          <Image className="logo" src="/logo.png" alt="" width={54} height={54} priority />
          <div className="brand-text">
            <div className="kicker">Suite Portal · Admin</div>
            <h1>Staff access</h1>
          </div>
        </header>

        <div className="admin-summary" data-testid="summary">
          <div className="stat">
            <span className="stat-n">{counts.active}</span>
            <span className="stat-l">active</span>
          </div>
          <div className="stat">
            <span className="stat-n">{counts.admins}</span>
            <span className="stat-l">admins</span>
          </div>
          <div className="stat">
            <span className="stat-n">{counts.pending}</span>
            <span className="stat-l">not yet signed in</span>
          </div>
        </div>

        <section className="card">
          <h2 className="card-title">Who can reach what</h2>
          <p className="card-note">
            A change takes effect the next time that person loads the portal. Nobody is
            ever deleted — deactivate instead, so the record of what they had survives.
          </p>
          <StaffTable staff={staff} currentEmail={access.email} />
        </section>

        <section className="card">
          <h2 className="card-title">Add somebody</h2>
          <p className="card-note">
            They get an email with a sign-in link. Access starts empty; grant apps above
            once they appear in the list.
          </p>
          <InviteForm />
        </section>

        <p className="back">
          <Link href="/">← Back to the portal</Link>
        </p>
      </div>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { tilesFor } from "@/lib/apps";
import type { AppKey } from "@/lib/guard";
import type { Access } from "@/lib/staff";

/**
 * The frame every app route sits in: the brand lockup, a switcher showing only
 * the apps this person may open, and sign-out.
 *
 * Being one app is what makes this possible — the switcher is a list of links,
 * not four deployments trying to agree on a session.
 */
export function AppShell({
  access,
  current,
  title,
  children,
}: {
  access: Access;
  current: AppKey;
  title: string;
  children: React.ReactNode;
}) {
  const others = tilesFor(access).filter((t) => t.id !== current);

  return (
    <main className="shell app-shell">
      <div className="app-wrap">
        <header>
          <Link href="/" className="logo-link" aria-label="Back to the portal">
            <Image className="logo" src="/logo.png" alt="" width={54} height={54} priority />
          </Link>
          <div className="brand-text">
            <div className="kicker">Suite Portal</div>
            <h1>{title}</h1>
          </div>
        </header>

        {others.length > 0 ? (
          <nav className="switcher" aria-label="Your other apps" data-testid="switcher">
            {others.map((tile) => (
              <Link key={tile.id} href={tile.href} data-testid={`switch-${tile.id}`}>
                {tile.name}
              </Link>
            ))}
            <form action={signOut} className="switcher-out">
              <button type="submit" data-testid="signout">
                Sign out
              </button>
            </form>
          </nav>
        ) : null}

        {children}
      </div>
    </main>
  );
}

import Image from "next/image";
import { signOut } from "@/auth";
import { tilesFor } from "@/lib/apps";
import { isTestMode } from "@/lib/env";
import type { Access } from "@/lib/staff";
import { TileIcon } from "./TileIcon";

export function Portal({ access }: { access: Access }) {
  const tiles = tilesFor(access);

  return (
    <div className="wrap">
      <header>
        <Image className="logo" src="/logo.png" alt="Power Analytix logo" width={54} height={54} priority />
        <div className="brand-text">
          <div className="kicker">Suite Portal</div>
          <h1>Power Analytix</h1>
        </div>
      </header>

      <div className="card">
        <div className="greeting">
          Welcome back, <b data-testid="user-name">{access.displayName}</b>
        </div>

        {tiles.length > 0 ? (
          <div className="tiles" data-testid="tiles">
            {tiles.map((tile) => (
              <a
                key={tile.id}
                className={tile.tone === "admin" ? "tile admin" : "tile"}
                href={tile.href}
                data-testid={`tile-${tile.id}`}
              >
                <span className="tile-ico">
                  <TileIcon id={tile.id} />
                </span>
                <span className="tile-name">{tile.name}</span>
                <span className="tile-sub">{tile.blurb}</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="msg warn" data-testid="no-access">
            You don&rsquo;t currently have access to any apps. Contact your administrator.
          </div>
        )}

        <form
          action={async () => {
            "use server";
            if (isTestMode()) return;
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="btn-ghost" type="submit" data-testid="signout">
            Sign out
          </button>
        </form>
      </div>

      <footer>
        Power Analytix · one sign-in for the whole suite. ·{" "}
        <span style={{ opacity: 0.7 }}>v3.0</span>
      </footer>
    </div>
  );
}

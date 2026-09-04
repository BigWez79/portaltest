import Image from "next/image";
import { signOut } from "@/app/actions/auth";
import { tilesFor } from "@/lib/apps";
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

        {/*
          Always at least one tile. My Profile has no flag, so every active staff
          member has it — and somebody with no active row never reaches this
          component: the portal page ends their session instead of showing them
          a portal with nothing in it.
        */}
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

        <form action={signOut}>
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

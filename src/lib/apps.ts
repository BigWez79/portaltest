import type { Access } from "./staff";
import type { AppKey } from "./guard";

export type AppTile = {
  id: AppKey;
  name: string;
  blurb: string;
  href: string;
  tone: "brand" | "admin";
  grants: (access: Access) => boolean;
};

/**
 * The four tiles.
 *
 * Every href is a route inside this app. Invoices, Timesheets and Expenses used
 * to be separate deployments on their own subdomains; they are being folded in
 * here so there is one repo, one test suite, one deploy and one sign-in, with no
 * session shared across origins to get wrong.
 *
 * Adding a tile means: an entry here, a glyph in TileIcon, a route under
 * src/app that calls requireApp, a column in a migration, a Flag in
 * staff-admin.ts, a column in StaffTable, and a case in the access matrix.
 */
export const APP_TILES: AppTile[] = [
  {
    id: "invoices",
    name: "Invoices",
    blurb: "Create, edit and print customer invoices.",
    href: "/invoices",
    tone: "brand",
    grants: (a) => a.apps.invoices,
  },
  {
    id: "timesheet",
    name: "Timesheets",
    blurb: "Log your daily hours and activities.",
    href: "/timesheets",
    tone: "brand",
    grants: (a) => a.apps.timesheet,
  },
  {
    id: "expenses",
    name: "Expenses",
    blurb: "Log expenses, mileage and monthly claims.",
    href: "/expenses",
    tone: "brand",
    grants: (a) => a.apps.expenses,
  },
  {
    id: "admin",
    name: "Admin",
    blurb: "Staff access, invites, and who can reach what.",
    href: "/admin",
    tone: "admin",
    grants: (a) => a.isAdmin,
  },
];

export const tilesFor = (access: Access) => APP_TILES.filter((t) => t.grants(access));

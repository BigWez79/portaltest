import type { Access } from "./staff";

export type AppTile = {
  id: string;
  name: string;
  blurb: string;
  href: string;
  tone: "brand" | "admin";
  grants: (access: Access) => boolean;
};

/**
 * The four tiles, unchanged from portal v2.0. Hrefs stay absolute: Invoices,
 * Timesheets and Expenses are separate apps on their own subdomains and none of
 * them move in this rebuild.
 */
export const APP_TILES: AppTile[] = [
  {
    id: "invoices",
    name: "Invoices",
    blurb: "Create, edit and print customer invoices.",
    href: "https://invoices.poweranalytix.co.uk/",
    tone: "brand",
    grants: (a) => a.apps.invoices,
  },
  {
    id: "timesheet",
    name: "Timesheets",
    blurb: "Log your daily hours and activities.",
    href: "https://timesheet.poweranalytix.co.uk/",
    tone: "brand",
    grants: (a) => a.apps.timesheet,
  },
  {
    id: "expenses",
    name: "Expenses",
    blurb: "Log expenses, mileage and monthly claims.",
    href: "https://expenses.poweranalytix.co.uk/",
    tone: "brand",
    grants: (a) => a.apps.expenses,
  },
  {
    id: "admin",
    name: "Admin",
    blurb: "Timesheet overview, expense claims, invoice admin.",
    href: "https://portal.poweranalytix.co.uk/admin",
    tone: "admin",
    grants: (a) => a.isAdmin,
  },
];

export const tilesFor = (access: Access) => APP_TILES.filter((t) => t.grants(access));

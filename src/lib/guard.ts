import "server-only";
import { notFound } from "next/navigation";
import { getCurrentUser } from "./current-user";
import { resolveAccess, type Access } from "./staff";

export type AppKey =
  | "invoices"
  | "timesheet"
  | "expenses"
  | "margin"
  | "taxBreakdown"
  | "profile"
  | "admin";

/**
 * The gate every app route goes through. One function, so a new route is
 * protected the same way as the others or not at all.
 *
 * notFound() rather than a redirect or a 403: a 403 confirms the route exists,
 * which tells somebody without access what there is to go looking for.
 *
 * Server actions do not get to rely on this — they re-check the caller
 * themselves, because an action is a public endpoint and rendering the page that
 * calls it is not a check.
 */
export async function requireApp(key: AppKey): Promise<Access> {
  const user = await getCurrentUser();
  if (!user) notFound();

  const access = await resolveAccess(user);

  // Admin needs the admin flag; My Profile needs only an active staff row —
  // that is how the live portal has always worked. Everything else is a flag.
  const allowed =
    key === "admin"
      ? access.isAdmin
      : key === "profile"
        ? access.isStaff
        : access.apps[key];

  if (!allowed) notFound();

  return access;
}

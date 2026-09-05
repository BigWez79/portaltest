import "server-only";
import { bootstrapAdmins, staffSource } from "./env";

export type StaffRow = {
  email: string;
  fullName: string | null;
  active: boolean;
  isAdmin: boolean;
  hasInvoices: boolean;
  hasTimesheet: boolean;
  hasExpenses: boolean;
  hasMargin: boolean;
  hasTaxBreakdown: boolean;
  invitedAt?: string | null;
  lastSeenAt?: string | null;
};

export type Access = {
  displayName: string;
  email: string;
  isAdmin: boolean;
  isBootstrapAdmin: boolean;
  /** an active staff row exists — what My Profile needs, no flag involved */
  isStaff: boolean;
  /** signed in, but no active staff row was found */
  unknownToStaffList: boolean;
  /**
   * A staff row exists and says this person is not active — as opposed to no
   * row at all, which is also "no access" but is not the same fact. Only this
   * one is a positive statement that somebody has been deactivated, and only
   * this one ends their session: a lookup that failed returns no row, and
   * signing people out because a query fell over is not a fix for anything.
   */
  deactivated: boolean;
  apps: {
    invoices: boolean;
    timesheet: boolean;
    expenses: boolean;
    margin: boolean;
    taxBreakdown: boolean;
  };
};

type Identity = {
  email: string | null | undefined;
  name?: string | null;
};

// Kept as one string literal on purpose: supabase-js infers the row type from
// the literal, and a concatenation turns the whole select into an error type.
// prettier-ignore
export const STAFF_COLUMNS = "email, full_name, active, is_admin, has_invoices, has_timesheet, has_expenses, has_margin, has_tax_breakdown, invited_at, last_seen_at";

export function toStaffRow(row: Record<string, unknown>): StaffRow {
  return {
    email: String(row.email ?? ""),
    fullName: (row.full_name as string | null) ?? null,
    active: row.active === true,
    isAdmin: row.is_admin === true,
    hasInvoices: row.has_invoices === true,
    hasTimesheet: row.has_timesheet === true,
    hasExpenses: row.has_expenses === true,
    hasMargin: row.has_margin === true,
    hasTaxBreakdown: row.has_tax_breakdown === true,
    invitedAt: (row.invited_at as string | null) ?? null,
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
  };
}

/**
 * The signed-in person's own row.
 *
 * Read with the caller's session, not the service role, so row level security
 * decides what comes back: the "staff read own row" policy means this query
 * cannot return anybody else even if the filter were wrong.
 */
export async function lookupStaff(email: string): Promise<StaffRow | null> {
  const key = email.toLowerCase();
  if (!key) return null;

  if (staffSource() === "fixture") {
    const { fixtureStore } = await import("./fixture-store");
    return fixtureStore.find([key]);
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  const { data, error } = await client.from("staff").select(STAFF_COLUMNS).limit(1);

  if (error) {
    console.error("[staff] lookup failed", error.message);
    return null;
  }
  const row = data?.[0] as Record<string, unknown> | undefined;
  return row ? toStaffRow(row) : null;
}

/**
 * Who sees what.
 *
 *   bootstrap admin        -> everything
 *   active row + flag      -> that app
 *   active row + is_admin  -> admin
 *   inactive row / no row  -> nothing
 *
 * An inactive row also reports `deactivated`, which the portal acts on by
 * ending the session rather than showing a signed-in page with a warning on it.
 */
export async function resolveAccess(identity: Identity): Promise<Access> {
  const email = (identity.email ?? "").toLowerCase();
  const isBootstrapAdmin = bootstrapAdmins().includes(email);

  const row = await lookupStaff(email);
  const active = row?.active === true;

  if (!row && !isBootstrapAdmin) {
    console.warn(
      JSON.stringify({
        event: "staff.lookup.miss",
        email,
        source: staffSource(),
      }),
    );
  }

  const grant = (flag: boolean | undefined) => isBootstrapAdmin || (active && flag === true);

  return {
    displayName: row?.fullName || identity.name || email || "there",
    email,
    isAdmin: grant(row?.isAdmin),
    isBootstrapAdmin,
    isStaff: isBootstrapAdmin || active,
    unknownToStaffList: !row && !isBootstrapAdmin,
    deactivated: !isBootstrapAdmin && row !== null && !active,
    apps: {
      invoices: grant(row?.hasInvoices),
      timesheet: grant(row?.hasTimesheet),
      expenses: grant(row?.hasExpenses),
      margin: grant(row?.hasMargin),
      taxBreakdown: grant(row?.hasTaxBreakdown),
    },
  };
}

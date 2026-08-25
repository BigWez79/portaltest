import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { bootstrapAdmins, staffSource, supabase as supabaseEnv } from "./env";

export type StaffRow = {
  email: string;
  upn: string | null;
  officialName: string | null;
  active: boolean;
  isAdmin: boolean;
  hasInvoices: boolean;
  hasTimesheet: boolean;
  hasExpenses: boolean;
};

export type Access = {
  displayName: string;
  email: string;
  isAdmin: boolean;
  isBootstrapAdmin: boolean;
  /** true when the person signed in but no active staff row was found */
  unknownToStaffList: boolean;
  apps: {
    invoices: boolean;
    timesheet: boolean;
    expenses: boolean;
  };
};

type Identity = {
  email: string | null | undefined;
  upn?: string | null;
  name?: string | null;
};

/* ------------------------------------------------------------------ */
/* row sources                                                         */
/* ------------------------------------------------------------------ */

let client: ReturnType<typeof createClient> | null = null;
function supabaseClient() {
  if (!client) {
    client = createClient(supabaseEnv.url, supabaseEnv.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

async function fromSupabase(keys: string[]): Promise<StaffRow | null> {
  // The service-role key is used here and only here, on the server. RLS on the
  // staff table has no policies at all, so nothing but this role can read it.
  const { data, error } = await supabaseClient()
    .from("staff")
    .select(
      "email, upn, official_name, active, is_admin, has_invoices, has_timesheet, has_expenses",
    )
    .or(keys.map((k) => `email.eq.${k},upn.eq.${k}`).join(","))
    .limit(1);

  if (error) {
    console.error("[staff] supabase lookup failed", error.message);
    return null;
  }
  const row = data?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    email: String(row.email ?? ""),
    upn: (row.upn as string | null) ?? null,
    officialName: (row.official_name as string | null) ?? null,
    active: row.active === true,
    isAdmin: row.is_admin === true,
    hasInvoices: row.has_invoices === true,
    hasTimesheet: row.has_timesheet === true,
    hasExpenses: row.has_expenses === true,
  };
}

async function fromFixture(keys: string[]): Promise<StaffRow | null> {
  const file = path.join(process.cwd(), "tests", "fixtures", "staff.json");
  const rows = JSON.parse(await readFile(file, "utf8")) as StaffRow[];
  return (
    rows.find(
      (r) =>
        keys.includes(r.email.toLowerCase()) ||
        (r.upn ? keys.includes(r.upn.toLowerCase()) : false),
    ) ?? null
  );
}

export async function lookupStaff(keys: string[]): Promise<StaffRow | null> {
  const clean = [...new Set(keys.filter(Boolean).map((k) => k.toLowerCase()))];
  if (clean.length === 0) return null;
  return staffSource() === "fixture" ? fromFixture(clean) : fromSupabase(clean);
}

/* ------------------------------------------------------------------ */
/* access resolution                                                   */
/* ------------------------------------------------------------------ */

/**
 * Mirrors portal v2.0 exactly, with one change: a hidden tile is now an absent
 * tile.
 *
 *   bootstrap admin            -> everything
 *   active row + Has* flag     -> that app
 *   active row + IsAdmin       -> admin
 *   inactive row / no row      -> nothing
 */
export async function resolveAccess(identity: Identity): Promise<Access> {
  const email = (identity.email ?? "").toLowerCase();
  const upn = (identity.upn ?? "").toLowerCase();

  const isBootstrapAdmin =
    bootstrapAdmins().includes(email) || (upn !== "" && bootstrapAdmins().includes(upn));

  const row = await lookupStaff([email, upn]);
  const active = row?.active === true;

  if (!row && !isBootstrapAdmin) {
    console.warn(`[staff] no row for ${email || upn || "(no address)"}`);
  }

  const grant = (flag: boolean | undefined) => isBootstrapAdmin || (active && flag === true);

  return {
    displayName: row?.officialName || identity.name || email || "there",
    email,
    isAdmin: grant(row?.isAdmin),
    isBootstrapAdmin,
    unknownToStaffList: !row && !isBootstrapAdmin,
    apps: {
      invoices: grant(row?.hasInvoices),
      timesheet: grant(row?.hasTimesheet),
      expenses: grant(row?.hasExpenses),
    },
  };
}

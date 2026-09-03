import "server-only";
import { siteUrl, staffSource } from "./env";
import { STAFF_COLUMNS, toStaffRow, type StaffRow } from "./staff";
import type { FlagSnapshot } from "./staff-audit";

export const FLAGS = [
  "active",
  "isAdmin",
  "hasInvoices",
  "hasTimesheet",
  "hasExpenses",
  "hasMargin",
  "hasTaxBreakdown",
] as const;
export type Flag = (typeof FLAGS)[number];

/** flag -> the column it lives in, and the key it has in an audit row's jsonb. */
export const FLAG_COLUMN: Record<Flag, string> = {
  active: "active",
  isAdmin: "is_admin",
  hasInvoices: "has_invoices",
  hasTimesheet: "has_timesheet",
  hasExpenses: "has_expenses",
  hasMargin: "has_margin",
  hasTaxBreakdown: "has_tax_breakdown",
};

const snapshotOf = (row: StaffRow): FlagSnapshot =>
  Object.fromEntries(FLAGS.map((flag) => [flag, row[flag] === true])) as FlagSnapshot;

/**
 * The audit row Postgres writes for itself.
 *
 * In a real environment the trigger on `staff` does this, stamped with
 * `auth.uid()`. The fixture store has no triggers, so the same record is written
 * here — and who is calling is read from the session rather than passed in, for
 * the same reason Postgres reads it from the JWT: an argument can be wrong.
 */
async function recordFixtureChange(
  email: string,
  before: FlagSnapshot | null,
  after: FlagSnapshot,
): Promise<void> {
  const [{ auditStore }, { getCurrentUser }] = await Promise.all([
    import("./audit-store"),
    import("./current-user"),
  ]);
  const caller = await getCurrentUser();
  await auditStore.record({
    email: email.toLowerCase(),
    byEmail: caller?.email ?? null,
    before,
    after,
  });
}

/**
 * Every staff row.
 *
 * Read with the caller's session. The "admins read every row" policy is what
 * makes this return more than one row — a non-admin who reached this function
 * would get their own row back and nothing else, so a missing guard upstream
 * cannot leak the directory.
 */
export async function listStaff(): Promise<StaffRow[]> {
  if (staffSource() === "fixture") {
    const { fixtureStore } = await import("./fixture-store");
    const rows = await fixtureStore.all();
    return [...rows].sort((a, b) => a.email.localeCompare(b.email));
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  const { data, error } = await client.from("staff").select(STAFF_COLUMNS).order("email");

  if (error) {
    console.error("[staff-admin] list failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => toStaffRow(r as Record<string, unknown>));
}

export async function setFlag(email: string, flag: Flag, value: boolean): Promise<void> {
  if (staffSource() === "fixture") {
    const { fixtureStore } = await import("./fixture-store");
    const before = await fixtureStore.find([email.toLowerCase()]);
    const after = await fixtureStore.update(email, { [flag]: value } as Partial<StaffRow>);
    if (before && after) {
      await recordFixtureChange(after.email, snapshotOf(before), snapshotOf(after));
    }
    return;
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  const { error } = await client
    .from("staff")
    .update({ [FLAG_COLUMN[flag]]: value })
    .eq("email", email);

  if (error) throw new Error(`Could not update ${email}: ${error.message}`);
}

/**
 * Adds somebody to the staff list and emails them an invitation.
 *
 * The invite is the only place the service role is used at request time —
 * auth.admin.inviteUserByEmail has no user-scoped equivalent. The staff row
 * itself goes in through the caller's own session so the RLS insert policy and
 * the audit trigger both apply.
 */
export async function inviteStaff(
  email: string,
  fullName: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const address = email.trim().toLowerCase();

  if (staffSource() === "fixture") {
    const { fixtureStore } = await import("./fixture-store");
    try {
      const row = await fixtureStore.insert({
        email: address,
        fullName: fullName || null,
        active: true,
        isAdmin: false,
        hasInvoices: false,
        hasTimesheet: false,
        hasExpenses: false,
        hasMargin: false,
        hasTaxBreakdown: false,
        invitedAt: "2026-08-25T00:00:00.000Z",
        lastSeenAt: null,
      });
      await recordFixtureChange(row.email, null, snapshotOf(row));
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed" };
    }
  }

  const { supabaseServer, supabaseAdmin } = await import("./supabase/server");
  const client = await supabaseServer();

  const { error: insertError } = await client.from("staff").insert({
    email: address,
    full_name: fullName || null,
    active: true,
    invited_at: new Date().toISOString(),
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, message: `${address} is already on the staff list.` };
    }
    return { ok: false, message: insertError.message };
  }

  const { error: inviteError } = await supabaseAdmin().auth.admin.inviteUserByEmail(address, {
    redirectTo: `${siteUrl()}/auth/callback`,
  });

  if (inviteError) {
    // The row exists; the email did not go. Say so plainly rather than pretending
    // it worked — an admin who thinks an invite was sent will not resend it.
    return {
      ok: false,
      message: `${address} was added, but the invitation email failed: ${inviteError.message}`,
    };
  }

  return { ok: true };
}

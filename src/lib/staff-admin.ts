import "server-only";
import { siteUrl, staffSource } from "./env";
import { STAFF_COLUMNS, toStaffRow, type StaffRow } from "./staff";

export const FLAGS = ["active", "isAdmin", "hasInvoices", "hasTimesheet", "hasExpenses"] as const;
export type Flag = (typeof FLAGS)[number];

const COLUMN: Record<Flag, string> = {
  active: "active",
  isAdmin: "is_admin",
  hasInvoices: "has_invoices",
  hasTimesheet: "has_timesheet",
  hasExpenses: "has_expenses",
};

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
    await fixtureStore.update(email, { [flag]: value } as Partial<StaffRow>);
    return;
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  const { error } = await client
    .from("staff")
    .update({ [COLUMN[flag]]: value })
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
      await fixtureStore.insert({
        email: address,
        fullName: fullName || null,
        active: true,
        isAdmin: false,
        hasInvoices: false,
        hasTimesheet: false,
        hasExpenses: false,
        invitedAt: "2026-08-25T00:00:00.000Z",
        lastSeenAt: null,
      });
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

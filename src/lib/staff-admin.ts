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
  "hasOverview",
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
  hasOverview: "has_overview",
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
        hasOverview: false,
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

/**
 * Send the invitation again.
 *
 * The row already exists, so this is only the email. It is a separate action
 * from inviting because the failure it exists for is the one `inviteStaff`
 * reports and cannot fix: the staff row was written and the email did not go.
 * Without this an admin's only move is to delete the person and start again,
 * which throws away their access flags and their audit history.
 */
export async function resendInvite(
  email: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const address = email.trim().toLowerCase();

  if (staffSource() === "fixture") {
    const { fixtureStore } = await import("./fixture-store");
    const row = await fixtureStore.find([address]);
    if (!row) return { ok: false, message: `${address} is not on the staff list.` };
    if (!row.active) return { ok: false, message: `${address} is not active.` };
    return { ok: true };
  }

  const { supabaseServer, supabaseAdmin } = await import("./supabase/server");
  const client = await supabaseServer();

  // Read through the caller's own session first. An admin resending to somebody
  // who is not on the list would otherwise create an auth user with no staff
  // row — an account that can sign in and reach nothing, which is worse than
  // an error message.
  const { data, error } = await client.from("staff").select("email, active").eq("email", address);
  if (error) return { ok: false, message: error.message };
  const row = data?.[0] as { email: string; active: boolean } | undefined;
  if (!row) return { ok: false, message: `${address} is not on the staff list.` };
  if (!row.active) {
    return { ok: false, message: `${address} is not active. Reactivate them first.` };
  }

  const { error: inviteError } = await supabaseAdmin().auth.admin.inviteUserByEmail(address, {
    redirectTo: `${siteUrl()}/auth/callback`,
  });
  if (inviteError) return { ok: false, message: inviteError.message };
  return { ok: true };
}

/**
 * Take somebody off the staff list.
 *
 * DEACTIVATION IS NOT THIS. Setting `active` to false ends a session and takes
 * every tile away, and it is the right answer almost every time — the audit
 * trail keeps saying who did what, and their invoices and timesheets still
 * point at a row that exists.
 *
 * Removal is for the row that should never have been there: a typo in an
 * address, somebody added twice. So it refuses to remove anybody who has left
 * anything behind, and says what. Deleting a person whose name is on an invoice
 * would leave that document pointing at nobody.
 */
export async function removeStaff(
  email: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const address = email.trim().toLowerCase();

  const owned = await whatTheyHave(address);
  if (owned.length > 0) {
    return {
      ok: false,
      message: `${address} has ${owned.join(" and ")}. Deactivate them instead — their records point at this row.`,
    };
  }

  if (staffSource() === "fixture") {
    const { fixtureStore } = await import("./fixture-store");
    const row = await fixtureStore.find([address]);
    if (!row) return { ok: false, message: `${address} is not on the staff list.` };
    // Recorded as "everything off", which is what is true of somebody who is
    // no longer on the list. The audit row outlives the staff row on purpose:
    // who removed whom is exactly the change worth being able to look up.
    const nothing = Object.fromEntries(FLAGS.map((f) => [f, false])) as FlagSnapshot;
    await recordFixtureChange(row.email, snapshotOf(row), nothing);
    await fixtureStore.remove(address);
    return { ok: true };
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { error } = await client.from("staff").delete().eq("email", address);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * What a person would leave behind. Empty means nothing points at them.
 *
 * Counted through the caller's own session, so an admin's policy is what makes
 * these visible (rule 11) — and a non-admin calling the action it guards sees
 * zero of everything and is refused by the check above it instead.
 */
async function whatTheyHave(email: string): Promise<string[]> {
  const key = email.toLowerCase();
  let invoices = 0;
  let expenses = 0;
  let entries = 0;

  if (staffSource() === "fixture") {
    const [{ invoiceStore }, { expenseStore }, { timesheetStore }] = await Promise.all([
      import("./invoices-store"),
      import("./expenses-store"),
      import("./timesheets-store"),
    ]);
    invoices = (await invoiceStore.invoicesFor(key)).length;
    expenses = (await expenseStore.listFor(key)).length;
    entries = (await timesheetStore.entriesFor(key)).length;
  } else {
    const { supabaseServer } = await import("./supabase/server");
    const client = await supabaseServer();
    const counts = await Promise.all(
      (["invoices", "expenses", "timesheet_entries"] as const).map(async (table) => {
        const column = table === "invoices" ? "seller_email" : "staff_email";
        const { count } = await client
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq(column, key);
        return count ?? 0;
      }),
    );
    [invoices, expenses, entries] = counts;
  }

  const out: string[] = [];
  if (invoices > 0) out.push(`${invoices} invoice${invoices === 1 ? "" : "s"}`);
  if (expenses > 0) out.push(`${expenses} expense${expenses === 1 ? "" : "s"}`);
  if (entries > 0) out.push(`${entries} timesheet entr${entries === 1 ? "y" : "ies"}`);
  return out;
}

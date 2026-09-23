import "server-only";
import { staffSource } from "./env";
import { DEFAULT_RATES, toExpense, type Expense, type ExpenseInput, type MileageRates } from "./expenses-calc";

/**
 * Expenses — the caller's own claims, and the rates that price a mile.
 *
 * Reads go through the caller's own session so row level security decides what
 * comes back (CLAUDE.md rule 11, and 0004_expenses.sql). Nothing here reaches
 * for the service role: an expenses list filtered by the application rather
 * than by Postgres is the shape the live page already got wrong, and its own
 * comments say so.
 *
 * The shapes and the arithmetic are in expenses-calc.ts, which the browser may
 * import. This file may not be.
 */

export * from "./expenses-calc";

const COLUMNS =
  "id, staff_email, staff_name, expense_date, expense_type, miles, from_location, to_location, amount, reason, receipt_held, notes, claim_month, submitted_on";

/* -------------------------------------------------------------------------
   Reads
   ------------------------------------------------------------------------- */

export async function listExpenses(email: string): Promise<Expense[]> {
  const key = email.toLowerCase();
  if (!key) return [];

  if (staffSource() === "fixture") {
    const { expenseStore } = await import("./expenses-store");
    return expenseStore.listFor(key);
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  // No .eq() on staff_email: the policy already limits this to the caller's own
  // rows. Filtering here as well would read as the thing keeping other people's
  // claims out, and the next person to touch it would believe that.
  const { data, error } = await client
    .from("expenses")
    .select(COLUMNS)
    .order("expense_date", { ascending: false });

  if (error) {
    console.error("[expenses] list failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => toExpense(row as Record<string, unknown>));
}

export async function getRates(): Promise<MileageRates> {
  if (staffSource() === "fixture") {
    const { expenseStore } = await import("./expenses-store");
    return expenseStore.rates();
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { data, error } = await client
    .from("expense_settings")
    .select("rate1, threshold, rate2")
    .limit(1);

  if (error || !data?.[0]) {
    if (error) console.error("[expenses] rates failed", error.message);
    return DEFAULT_RATES;
  }
  const row = data[0] as Record<string, unknown>;
  return {
    rate1: Number(row.rate1 ?? DEFAULT_RATES.rate1),
    threshold: Number(row.threshold ?? DEFAULT_RATES.threshold),
    rate2: Number(row.rate2 ?? DEFAULT_RATES.rate2),
  };
}

export async function lockedMonths(email: string): Promise<string[]> {
  const key = email.toLowerCase();
  if (!key) return [];

  if (staffSource() === "fixture") {
    const { expenseStore } = await import("./expenses-store");
    return expenseStore.locksFor(key);
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { data, error } = await client.from("expense_claim_locks").select("claim_month");
  if (error) {
    console.error("[expenses] locks failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => String((r as Record<string, unknown>).claim_month));
}

/* -------------------------------------------------------------------------
   Writes — always as the caller, never as the service role
   ------------------------------------------------------------------------- */

export async function saveExpense(
  email: string,
  name: string | null,
  input: ExpenseInput,
  id?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = email.toLowerCase();

  if (staffSource() === "fixture") {
    const { expenseStore } = await import("./expenses-store");
    return expenseStore.save(key, name, input, id);
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  const row = {
    staff_email: key,
    staff_name: name,
    expense_date: input.expenseDate,
    expense_type: input.expenseType,
    miles: input.miles,
    from_location: input.fromLocation || null,
    to_location: input.toLocation || null,
    amount: input.amount,
    reason: input.reason || null,
    receipt_held: input.receiptHeld,
    notes: input.notes || null,
  };

  const { error } = id
    ? await client.from("expenses").update(row).eq("id", id)
    : await client.from("expenses").insert(row);

  if (error) {
    console.error("[expenses] save failed", error.message);
    // A policy refusal and a locked month look the same from here, and the
    // locked month is the one a person can do something about.
    return { ok: false, message: "That expense could not be saved. The month may be locked." };
  }
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<boolean> {
  if (staffSource() === "fixture") {
    const { expenseStore } = await import("./expenses-store");
    return expenseStore.remove(id);
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { error } = await client.from("expenses").delete().eq("id", id);
  if (error) {
    console.error("[expenses] delete failed", error.message);
    return false;
  }
  return true;
}

export async function lockMonth(email: string, month: string): Promise<boolean> {
  const key = email.toLowerCase();

  if (staffSource() === "fixture") {
    const { expenseStore } = await import("./expenses-store");
    return expenseStore.lock(key, month);
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { error } = await client
    .from("expense_claim_locks")
    .insert({ staff_email: key, claim_month: month });
  if (error) {
    console.error("[expenses] lock failed", error.message);
    return false;
  }
  return true;
}

export async function saveRates(rates: MileageRates): Promise<boolean> {
  if (staffSource() === "fixture") {
    const { expenseStore } = await import("./expenses-store");
    return expenseStore.saveRates(rates);
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { error } = await client.from("expense_settings").update(rates).eq("id", true);
  if (error) {
    console.error("[expenses] rates save failed", error.message);
    return false;
  }
  return true;
}

/**
 * Everybody's claims, for an admin.
 *
 * The same query as `listExpenses` — the policy is what decides whether more
 * than one person's rows come back (rule 11), and an admin's session gets them
 * all. It is a separate function only so the *caller* has to say out loud that
 * it expects other people's data; the guard is still the policy, not the name.
 *
 * The caller must have checked `isAdmin` first. In fixture mode there is no
 * policy to lean on, so that check is the only thing standing here.
 */
export async function listAllExpenses(): Promise<Expense[]> {
  if (staffSource() === "fixture") {
    const { expenseStore } = await import("./expenses-store");
    return expenseStore.listAll();
  }

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { data, error } = await client
    .from("expenses")
    .select(COLUMNS)
    .order("expense_date", { ascending: false });

  if (error) {
    console.error("[expenses] list all failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => toExpense(row as Record<string, unknown>));
}

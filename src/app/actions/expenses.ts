"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import {
  EXPENSE_TYPES,
  type ExpenseInput,
  type ExpenseType,
  deleteExpense,
  getRates,
  listExpenses,
  lockMonth,
  mileageAmount,
  priorMilesInTaxYear,
  saveExpense,
  saveRates,
} from "@/lib/expenses";
import { resolveAccess } from "@/lib/staff";

export type ExpenseState = { status: "idle" | "ok" | "error"; message?: string };

/**
 * Every action re-checks the caller. A server action is a public endpoint —
 * rendering the form is not what stops somebody without the flag posting to it
 * (CLAUDE.md rule 5). The route's requireApp guard protects the page, not this.
 */
async function requireExpenses() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const access = await resolveAccess(user);
  if (!access.apps.expenses) throw new Error("No expenses access");
  return access;
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const access = await resolveAccess(user);
  if (!access.isAdmin) throw new Error("Not an admin");
  return access;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function submitExpense(
  _previous: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  let access;
  try {
    access = await requireExpenses();
  } catch {
    return { status: "error", message: "You are not allowed to add expenses." };
  }

  const id = String(formData.get("id") ?? "") || undefined;
  const expenseDate = String(formData.get("expenseDate") ?? "").trim();
  const expenseType = String(formData.get("expenseType") ?? "") as ExpenseType;

  if (!DATE.test(expenseDate)) {
    return { status: "error", message: "Please choose a date." };
  }
  if (!EXPENSE_TYPES.includes(expenseType)) {
    return { status: "error", message: "Please choose a type of expense." };
  }

  let miles: number | null = null;
  let amount: number;
  let receiptHeld = false;
  const fromLocation = String(formData.get("fromLocation") ?? "").trim();
  const toLocation = String(formData.get("toLocation") ?? "").trim();

  if (expenseType === "Mileage") {
    miles = Number(formData.get("miles"));
    if (!Number.isFinite(miles) || miles <= 0) {
      return { status: "error", message: "Enter the miles driven." };
    }
    // Priced on the server, from the caller's own rows. The live page computes
    // this in the browser, which means the amount is whatever the form posts.
    const [rates, mine] = await Promise.all([getRates(), listExpenses(access.email)]);
    amount = mileageAmount(miles, priorMilesInTaxYear(mine, expenseDate, id), rates);
  } else {
    amount = Number(formData.get("amount"));
    if (!Number.isFinite(amount) || amount < 0) {
      return { status: "error", message: "Enter the amount." };
    }
    amount = Number(amount.toFixed(2));
    receiptHeld = String(formData.get("receiptHeld") ?? "") === "yes";
  }

  const input: ExpenseInput = {
    expenseDate,
    expenseType,
    miles,
    fromLocation,
    toLocation,
    amount,
    reason: String(formData.get("reason") ?? "").trim(),
    receiptHeld,
    notes: String(formData.get("notes") ?? "").trim(),
  };

  const result = await saveExpense(access.email, access.displayName, input, id);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/expenses");
  return { status: "ok", message: id ? "Expense updated." : "Expense added." };
}

export async function removeExpense(
  _previous: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  try {
    await requireExpenses();
  } catch {
    return { status: "error", message: "You are not allowed to remove expenses." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Nothing to remove." };

  // The store and the policy both refuse a locked month; neither is trusted to
  // be the only one that does.
  const done = await deleteExpense(id);
  if (!done) {
    return { status: "error", message: "That could not be removed. The month may be locked." };
  }

  revalidatePath("/expenses");
  return { status: "ok", message: "Expense removed." };
}

export async function lockClaimMonth(
  _previous: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  let access;
  try {
    access = await requireExpenses();
  } catch {
    return { status: "error", message: "You are not allowed to submit a claim." };
  }

  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { status: "error", message: "Choose a month to submit." };
  }

  const done = await lockMonth(access.email, month);
  if (!done) return { status: "error", message: "That month could not be submitted." };

  revalidatePath("/expenses");
  return { status: "ok", message: "Claim submitted. That month is now locked." };
}

export async function updateRates(
  _previous: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  try {
    await requireAdmin();
  } catch {
    return { status: "error", message: "Only an admin can change the mileage rates." };
  }

  const rate1 = Number(formData.get("rate1"));
  const threshold = Number(formData.get("threshold"));
  const rate2 = Number(formData.get("rate2"));

  if (![rate1, threshold, rate2].every((n) => Number.isFinite(n) && n >= 0)) {
    return { status: "error", message: "Rates and threshold must be numbers, and not negative." };
  }

  const done = await saveRates({ rate1, threshold, rate2 });
  if (!done) return { status: "error", message: "The rates could not be saved." };

  revalidatePath("/expenses");
  return { status: "ok", message: "Mileage rates saved." };
}

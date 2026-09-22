
/**
 * Expenses — the shapes and the arithmetic, with no server in them.
 *
 * Split out of expenses.ts because the browser needs the types and the mileage
 * maths to preview a claim, and expenses.ts is `server-only`: importing it from
 * a client component drags the Supabase client into the browser bundle, which
 * is what `npm run check:secrets` exists to stop.
 */

export type ExpenseType =
  | "Mileage"
  | "Train/Bus"
  | "Taxi"
  | "Parking"
  | "Tolls"
  | "Hotel"
  | "Sundry"
  | "Other";

export const EXPENSE_TYPES: ExpenseType[] = [
  "Mileage",
  "Train/Bus",
  "Taxi",
  "Parking",
  "Tolls",
  "Hotel",
  "Sundry",
  "Other",
];

export type Expense = {
  id: string;
  staffEmail: string;
  staffName: string | null;
  expenseDate: string; // YYYY-MM-DD
  expenseType: ExpenseType;
  miles: number | null;
  fromLocation: string | null;
  toLocation: string | null;
  amount: number;
  reason: string | null;
  receiptHeld: boolean;
  notes: string | null;
  claimMonth: string; // YYYY-MM
  submittedOn: string;
};

export type MileageRates = { rate1: number; threshold: number; rate2: number };

export const DEFAULT_RATES: MileageRates = { rate1: 0.55, threshold: 10000, rate2: 0.25 };

const COLUMNS =
  "id, staff_email, staff_name, expense_date, expense_type, miles, from_location, to_location, amount, reason, receipt_held, notes, claim_month, submitted_on";

export function toExpense(row: Record<string, unknown>): Expense {
  return {
    id: String(row.id),
    staffEmail: String(row.staff_email ?? "").toLowerCase(),
    staffName: (row.staff_name as string) ?? null,
    expenseDate: String(row.expense_date ?? ""),
    expenseType: String(row.expense_type ?? "Other") as ExpenseType,
    miles: row.miles == null ? null : Number(row.miles),
    fromLocation: (row.from_location as string) ?? null,
    toLocation: (row.to_location as string) ?? null,
    amount: Number(row.amount ?? 0),
    reason: (row.reason as string) ?? null,
    receiptHeld: Boolean(row.receipt_held),
    notes: (row.notes as string) ?? null,
    claimMonth: String(row.claim_month ?? String(row.expense_date ?? "").slice(0, 7)),
    submittedOn: String(row.submitted_on ?? ""),
  };
}

/* -------------------------------------------------------------------------
   The tax year, and what a mile is worth in it
   ------------------------------------------------------------------------- */

/**
 * The UK tax year starts on 6 April. A journey on 5 April belongs to the year
 * that is ending; one on 6 April starts the new one. Carried across from the
 * live page unchanged — get this wrong and every mileage claim in early April
 * is priced against the wrong running total.
 */
export function taxYearStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 3, 6); // April is month 3, zero-based
  const from = d.getTime() >= start ? year : year - 1;
  return `${from}-04-06`;
}

/**
 * Tiered: the first `threshold` miles of the tax year at `rate1`, everything
 * beyond at `rate2`. `priorMiles` is what the person has already claimed since
 * the tax year began — so the same journey is worth less once somebody has
 * driven past the threshold, which is the whole point of the tier.
 */
export function mileageAmount(miles: number, priorMiles: number, rates: MileageRates): number {
  const m = Number(miles) || 0;
  const remaining = Math.max(0, rates.threshold - priorMiles);
  const atFirst = Math.min(m, remaining);
  const atSecond = m - atFirst;
  return Number((atFirst * rates.rate1 + atSecond * rates.rate2).toFixed(2));
}

/** Miles already claimed in the same tax year, excluding the row being edited. */
export function priorMilesInTaxYear(
  rows: Expense[],
  onDate: string,
  excludeId?: string,
): number {
  const start = taxYearStart(onDate);
  return rows
    .filter(
      (r) =>
        r.expenseType === "Mileage" &&
        r.id !== excludeId &&
        r.expenseDate >= start &&
        r.expenseDate < onDate,
    )
    .reduce((total, r) => total + (r.miles ?? 0), 0);
}


export type ExpenseInput = {
  expenseDate: string;
  expenseType: ExpenseType;
  miles: number | null;
  fromLocation: string;
  toLocation: string;
  amount: number;
  reason: string;
  receiptHeld: boolean;
  notes: string;
};

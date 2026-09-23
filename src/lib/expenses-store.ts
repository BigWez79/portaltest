import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_RATES,
  type Expense,
  type ExpenseInput,
  type MileageRates,
  toExpense,
} from "./expenses-calc";

/**
 * Test-only expenses store, so the suite can exercise the write path without a
 * live Supabase. Same shape as fixture-store.ts, for the same reasons:
 * seeded from tests/fixtures into .tmp so a test that adds a claim does not
 * edit a tracked file, and saved by rename so parallel workers never read half
 * a document.
 *
 * Reachable only when STAFF_SOURCE=fixture.
 *
 * It enforces the month lock itself. That is duplication of the policy in
 * 0004_expenses.sql, and deliberate: the suite would otherwise pass against a
 * store that lets a locked month be edited, and prove nothing about the rule
 * the real table enforces.
 */

type Doc = {
  expenses: Expense[];
  locks: { staffEmail: string; claimMonth: string }[];
  rates: MileageRates;
};

const SEED = path.join(process.cwd(), "tests", "fixtures", "expenses.json");
const WORKING = path.join(process.cwd(), ".tmp", "expenses.json");

/**
 * The seed is written in the database's spelling (`staff_email`) because that is
 * what a fixture of table rows should look like. The working copy is written in
 * the app's (`staffEmail`), because that is what was in memory. So this has to
 * read both: mapping a working copy through toExpense a second time looks for
 * snake_case keys that are no longer there and quietly yields a row with an
 * empty email, which belongs to nobody and therefore shows up for nobody.
 */
function normalise(raw: unknown): Doc {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    expenses: ((d.expenses as unknown[]) ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return "staffEmail" in row ? (row as unknown as Expense) : toExpense(row);
    }),
    locks: ((d.locks as Doc["locks"]) ?? []).map((l) => ({
      staffEmail: String(l.staffEmail).toLowerCase(),
      claimMonth: String(l.claimMonth),
    })),
    rates: { ...DEFAULT_RATES, ...((d.rates as MileageRates) ?? {}) },
  };
}

async function load(): Promise<Doc> {
  try {
    const [seedStat, workingStat] = await Promise.all([stat(SEED), stat(WORKING)]);
    if (seedStat.mtimeMs > workingStat.mtimeMs) throw new Error("seed is newer");
    return normalise(JSON.parse(await readFile(WORKING, "utf8")));
  } catch {
    const seed = normalise(JSON.parse(await readFile(SEED, "utf8")));
    await save(seed);
    return seed;
  }
}

/**
 * A random name, not a counter. Next loads a module more than once in one
 * process — a server component and a route handler get their own instance — so
 * a per-module counter restarts at zero in each, two saves pick the same
 * filename, and the second rename fails with ENOENT on a file the first one
 * has already moved. That surfaced here as a 500 on a page that was otherwise
 * fine.
 */
async function save(doc: Doc): Promise<void> {
  await mkdir(path.dirname(WORKING), { recursive: true });
  const pending = `${WORKING}.${randomUUID()}.tmp`;
  await writeFile(pending, JSON.stringify(doc, null, 2), "utf8");
  await rename(pending, WORKING);
}

function isLocked(doc: Doc, email: string, month: string): boolean {
  return doc.locks.some((l) => l.staffEmail === email && l.claimMonth === month);
}

export const expenseStore = {
  async listFor(email: string): Promise<Expense[]> {
    const doc = await load();
    return doc.expenses
      .filter((e) => e.staffEmail === email)
      .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  },

  /** Everybody's, for an admin. The caller checks that; this does not. */
  async listAll(): Promise<Expense[]> {
    const doc = await load();
    return [...doc.expenses].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  },

  async rates(): Promise<MileageRates> {
    return (await load()).rates;
  },

  async locksFor(email: string): Promise<string[]> {
    const doc = await load();
    return doc.locks.filter((l) => l.staffEmail === email).map((l) => l.claimMonth);
  },

  async save(
    email: string,
    name: string | null,
    input: ExpenseInput,
    id?: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const doc = await load();
    const month = input.expenseDate.slice(0, 7);

    if (isLocked(doc, email, month)) {
      return { ok: false, message: "That month is locked and can no longer be changed." };
    }

    const row: Expense = {
      id: id ?? randomUUID(),
      staffEmail: email,
      staffName: name,
      expenseDate: input.expenseDate,
      expenseType: input.expenseType,
      miles: input.miles,
      fromLocation: input.fromLocation || null,
      toLocation: input.toLocation || null,
      amount: input.amount,
      reason: input.reason || null,
      receiptHeld: input.receiptHeld,
      notes: input.notes || null,
      claimMonth: month,
      submittedOn: new Date().toISOString(),
    };

    if (id) {
      const at = doc.expenses.findIndex((e) => e.id === id && e.staffEmail === email);
      if (at === -1) return { ok: false, message: "That expense is no longer there." };
      doc.expenses[at] = row;
    } else {
      doc.expenses.push(row);
    }

    await save(doc);
    return { ok: true };
  },

  async remove(id: string): Promise<boolean> {
    const doc = await load();
    const row = doc.expenses.find((e) => e.id === id);
    if (!row) return false;
    if (isLocked(doc, row.staffEmail, row.claimMonth)) return false;
    doc.expenses = doc.expenses.filter((e) => e.id !== id);
    await save(doc);
    return true;
  },

  async lock(email: string, month: string): Promise<boolean> {
    const doc = await load();
    if (isLocked(doc, email, month)) return true;
    doc.locks.push({ staffEmail: email, claimMonth: month });
    await save(doc);
    return true;
  },

  async saveRates(rates: MileageRates): Promise<boolean> {
    const doc = await load();
    doc.rates = rates;
    await save(doc);
    return true;
  },

  /** Back to the seed. The suite calls this between write tests. */
  async reset(): Promise<void> {
    await save(normalise(JSON.parse(await readFile(SEED, "utf8"))));
  },
};

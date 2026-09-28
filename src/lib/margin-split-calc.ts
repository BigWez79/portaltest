/**
 * Margin Split — the shapes and the arithmetic. No server imports, so the page
 * and the actions share one copy of every sum.
 *
 * Money is integer pence and percentages are integer basis points (12.5% =
 * 1250) from the form to the database. Nothing is ever a float, so there is
 * nothing to round except where the task says to: a job's contribution, half-up
 * to the penny, and the pot's split, by largest remainder.
 */

export type Job = { id: string; name: string; jobDate: string; valuePence: number; marginBp: number };
export type Contractor = { id: string; name: string; shareBp: number; position: number };
export type Method = "cash" | "bank_transfer";
export type Drawing = {
  id: string;
  contractorId: string;
  drawnOn: string;
  amountPence: number;
  method: Method;
  note: string | null;
};

export const METHODS: Method[] = ["cash", "bank_transfer"];
export const FULL_SHARE = 10000;
/** £10m. Keeps value × basis points well inside Number's exact integers. */
export const MAX_PENCE = 1_000_000_000;

/** value × margin, rounded half-up to the penny. Both are non-negative. */
export function contribution(job: Pick<Job, "valuePence" | "marginBp">): number {
  return Math.floor((job.valuePence * job.marginBp + FULL_SHARE / 2) / FULL_SHARE);
}

export function potTotal(jobs: Job[]): number {
  return jobs.reduce((sum, j) => sum + contribution(j), 0);
}

/**
 * Largest remainder. Everybody gets the floor of their exact share; the pennies
 * left over go one each to the largest remainders, ties to whoever is listed
 * first. The result always sums to the pot — that is what the method is for.
 */
export function allocate(pot: number, contractors: Contractor[]): Map<string, number> {
  const ordered = [...contractors].sort((a, b) => a.position - b.position);
  const rows = ordered.map((c, order) => ({
    id: c.id,
    order,
    floor: Math.floor((pot * c.shareBp) / FULL_SHARE),
    remainder: (pot * c.shareBp) % FULL_SHARE,
  }));
  let left = pot - rows.reduce((sum, r) => sum + r.floor, 0);
  const byRemainder = [...rows].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (const r of byRemainder) {
    if (left <= 0) break;
    r.floor += 1;
    left -= 1;
  }
  return new Map(rows.map((r) => [r.id, r.floor]));
}

/** Equal shares that total exactly 10000, the spare points to the first listed. */
export function equalShares(count: number): number[] {
  if (count === 0) return [];
  const each = Math.floor(FULL_SHARE / count);
  return Array.from({ length: count }, (_, i) => each + (i < FULL_SHARE - each * count ? 1 : 0));
}

export type Summary = {
  pot: number;
  rows: {
    contractor: Contractor;
    allocated: number;
    cash: number;
    transfer: number;
    drawn: number;
    balance: number;
  }[];
  drawn: number;
  remaining: number;
};

export function summarise(jobs: Job[], contractors: Contractor[], drawings: Drawing[]): Summary {
  const pot = potTotal(jobs);
  const shares = allocate(pot, contractors);
  const rows = [...contractors]
    .sort((a, b) => a.position - b.position)
    .map((contractor) => {
      const own = drawings.filter((d) => d.contractorId === contractor.id);
      const cash = own.filter((d) => d.method === "cash").reduce((s, d) => s + d.amountPence, 0);
      const transfer = own
        .filter((d) => d.method === "bank_transfer")
        .reduce((s, d) => s + d.amountPence, 0);
      const allocated = shares.get(contractor.id) ?? 0;
      return { contractor, allocated, cash, transfer, drawn: cash + transfer, balance: allocated - cash - transfer };
    });
  const drawn = drawings.reduce((s, d) => s + d.amountPence, 0);
  return { pot, rows, drawn, remaining: pot - drawn };
}

/** "£1,234.56". Negative amounts are not formatted here; see `balance`. */
export function pounds(pence: number): string {
  const whole = Math.floor(Math.abs(pence) / 100).toLocaleString("en-GB");
  return `£${whole}.${String(Math.abs(pence) % 100).padStart(2, "0")}`;
}

/** A balance below zero reads "overdrawn £x.xx", never a minus sign. */
export function balance(pence: number): string {
  return pence < 0 ? `overdrawn ${pounds(-pence)}` : pounds(pence);
}

/** 1250 -> "12.5%". */
export function percent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}%`;
}

/**
 * "12.34" -> 1234, read as a string so no float is ever involved. Used for
 * pounds (pence) and percentages (basis points) alike: both are hundredths.
 * Null for anything else, including more than two decimal places.
 */
export function hundredths(text: string): number | null {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text.trim().replace(/^£/, "").replace(/,/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

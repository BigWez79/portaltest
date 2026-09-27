/**
 * Margin Split — the shapes and the arithmetic. No server imports, so the page
 * and the suite can both use it; margin-split.ts re-exports it for the server.
 *
 * Everything is an integer. Money is pence, percentages are basis points
 * (12.5% = 1250), and the multiplication is done in BigInt so a large job
 * cannot lose a penny to floating point on its way to the pot. The pot is
 * split by largest remainder, which is the one method that always hands out
 * exactly the pennies there are.
 */

export type DrawMethod = "cash" | "bank_transfer";
export const DRAW_METHODS: DrawMethod[] = ["cash", "bank_transfer"];

export type MsJob = {
  id: string;
  name: string;
  jobDate: string;
  valuePence: number;
  marginBp: number;
};

export type MsContractor = {
  id: string;
  name: string;
  shareBp: number;
  /** Listing order. Ties in the allocation go to the lower position. */
  position: number;
};

export type MsDrawing = {
  id: string;
  contractorId: string;
  drawDate: string;
  amountPence: number;
  method: DrawMethod;
  note: string | null;
};

export type MsData = {
  jobs: MsJob[];
  contractors: MsContractor[];
  drawings: MsDrawing[];
};

export const WHOLE_BP = 10000;

/** A job's contribution to the pot: value × margin, rounded half-up to the penny. */
export function contribution(valuePence: number, marginBp: number): number {
  const exact = BigInt(valuePence) * BigInt(marginBp);
  // Both are refused below zero on the way in, so half-up is floor(x + ½).
  return Number((exact + 5000n) / 10000n);
}

export function potTotal(jobs: MsJob[]): number {
  return jobs.reduce((sum, j) => sum + contribution(j.valuePence, j.marginBp), 0);
}

/**
 * Largest remainder. Each contractor gets the floor of their exact share; the
 * pennies left over go one each to the largest remainders, and a tie goes to
 * whoever is listed first. The result sums to the pot whenever the shares sum
 * to 10000 — which saving enforces, and which this does not assume: shares
 * that do not are a bug upstream, and it throws rather than invent pennies.
 */
export function allocate(pot: number, contractors: MsContractor[]): Map<string, number> {
  const ordered = [...contractors].sort((a, b) => a.position - b.position);
  const total = ordered.reduce((s, c) => s + c.shareBp, 0);
  if (ordered.length > 0 && total !== WHOLE_BP) {
    throw new Error(`shares total ${total} basis points, not ${WHOLE_BP}`);
  }

  const potBig = BigInt(pot);
  const parts = ordered.map((c, index) => {
    const exact = potBig * BigInt(c.shareBp);
    return {
      id: c.id,
      index,
      floor: Number(exact / 10000n),
      remainder: Number(exact % 10000n),
    };
  });

  let left = pot - parts.reduce((s, p) => s + p.floor, 0);
  const byRemainder = [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const out = new Map(parts.map((p) => [p.id, p.floor]));
  for (const p of byRemainder) {
    if (left <= 0) break;
    out.set(p.id, p.floor + 1);
    left -= 1;
  }
  return out;
}

/** Equal shares in basis points, split the same way — 3 gives 3334/3333/3333. */
export function equalShares(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(WHOLE_BP / count);
  const extra = WHOLE_BP - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

export type ContractorSummary = {
  id: string;
  name: string;
  shareBp: number;
  allocatedPence: number;
  cashPence: number;
  transferPence: number;
  drawnPence: number;
  balancePence: number;
};

export type MsSummary = {
  potPence: number;
  drawnPence: number;
  remainingPence: number;
  contractors: ContractorSummary[];
};

export function summarise(data: MsData): MsSummary {
  const potPence = potTotal(data.jobs);
  const allocation = allocate(potPence, data.contractors);
  const contractors = [...data.contractors]
    .sort((a, b) => a.position - b.position)
    .map((c) => {
      const mine = data.drawings.filter((d) => d.contractorId === c.id);
      const cashPence = mine
        .filter((d) => d.method === "cash")
        .reduce((s, d) => s + d.amountPence, 0);
      const transferPence = mine
        .filter((d) => d.method === "bank_transfer")
        .reduce((s, d) => s + d.amountPence, 0);
      const allocatedPence = allocation.get(c.id) ?? 0;
      const drawnPence = cashPence + transferPence;
      return {
        id: c.id,
        name: c.name,
        shareBp: c.shareBp,
        allocatedPence,
        cashPence,
        transferPence,
        drawnPence,
        balancePence: allocatedPence - drawnPence,
      };
    });
  const drawnPence = data.drawings.reduce((s, d) => s + d.amountPence, 0);
  return { potPence, drawnPence, remainingPence: potPence - drawnPence, contractors };
}

/* -------------------------------------------------------------------------
   Reading and writing figures as people type them
   ------------------------------------------------------------------------- */

/** "1234.5" -> 123450. Parsed as text, so 0.1 + 0.2 never enters into it. */
export function parsePence(input: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/[£,]/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** "12.5" -> 1250. Between 0 and 100 inclusive. */
export function parseBp(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, ""));
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp <= WHOLE_BP ? bp : null;
}

export function formatPence(pence: number): string {
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100).toLocaleString("en-GB");
  const p = String(abs % 100).padStart(2, "0");
  return `${pence < 0 ? "-" : ""}£${pounds}.${p}`;
}

/** A balance. Negative is said in words, not with a minus sign. */
export function formatBalance(pence: number): string {
  return pence < 0 ? `overdrawn ${formatPence(-pence)}` : formatPence(pence);
}

export function formatBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

/** The value an input shows for a share, "33.34". */
export function bpToInput(bp: number): string {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}`;
}

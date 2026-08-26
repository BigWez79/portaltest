/**
 * Margin & Profit Split — the sums, with no DOM in sight.
 *
 * Ported from `margin.html` on the live suite (read 25 August). The arithmetic
 * here is a straight transcription of that page's `calc()`, including the parts
 * that look odd, because the whole point of a port is that the same figures come
 * out. Three of them are worth naming so nobody "tidies" them later:
 *
 *   1. Carryover, investments, debts and the 50/50 pool are flat amounts. Only
 *      revenue and staff cost are scaled by the quarterly/annual factor.
 *   2. A staff line credited to an owner is not a business cost at all — it
 *      leaves the staff total and comes off the distributable profit instead,
 *      then lands in that owner's share.
 *   3. `addMonths` keeps the day of the month and lets the Date constructor
 *      overflow, so a quarter starting on the 31st runs to an odd-looking end.
 *
 * Everything is quarterly at heart; `periodFactor` scales to the selected view.
 *
 * No "server-only" here: this runs in the browser, and it touches nothing but
 * numbers.
 */

export type Period = "quarter" | "annual";

export type OwnerKey = "A" | "B";

/** What the live page writes to localStorage — numbers, no row ids. */
export type StoredStaff = {
  name: string;
  rate: number;
  m1: number;
  m2: number;
  m3: number;
  fifty: boolean;
  owner: "" | OwnerKey;
};

export type StoredItem = { name: string; amount: string | number };

export type StoredState = {
  startDate: string;
  revenue: number;
  split: number;
  nameA: string;
  nameB: string;
  staff: StoredStaff[];
  carry: StoredItem[];
  inv: StoredItem[];
  debtA: StoredItem[];
  debtB: StoredItem[];
};

/**
 * What the editor holds. Numerics are strings so a field can be empty while
 * somebody is typing in it, exactly as an `<input type=number>` behaves; the
 * sums coerce with the same `+value || 0` the live page uses.
 */
export type StaffLine = {
  id: string;
  name: string;
  rate: string;
  m1: string;
  m2: string;
  m3: string;
  fifty: boolean;
  owner: "" | OwnerKey;
};

export type ItemLine = { id: string; name: string; amount: string };

export type ItemKey = "carry" | "inv" | "debtA" | "debtB";

export type MarginState = {
  startDate: string;
  revenue: string;
  split: number;
  nameA: string;
  nameB: string;
  staff: StaffLine[];
  carry: ItemLine[];
  inv: ItemLine[];
  debtA: ItemLine[];
  debtB: ItemLine[];
};

/* ---------------------------------------------------------------------------
   Placeholder figures
   ---------------------------------------------------------------------------

   The live page ships pre-filled with a real quarter's revenue, a real owner
   split and a real debt to a named person — on a page with no sign-in, in a
   public repository. These are deliberately round, obviously invented numbers.
   See TASKS.md P1 and BLOCKED.md: replacing the live page's own defaults is a
   person's call; this route uses placeholders regardless.
   --------------------------------------------------------------------------- */
export const PRESET: StoredState = {
  startDate: "2026-01-01",
  revenue: 100000,
  split: 50,
  nameA: "Owner A",
  nameB: "Owner B",
  staff: [
    { name: "Example staff 1", rate: 500, m1: 20, m2: 20, m3: 20, fifty: false, owner: "" },
    { name: "Example staff 2", rate: 250, m1: 10, m2: 10, m3: 10, fifty: false, owner: "" },
  ],
  carry: [],
  inv: [],
  debtA: [],
  debtB: [],
};

/** The two browser-storage keys, unchanged from the live page. */
export const STORE_KEY = "marginSplitCalc_v2";
export const SCENARIO_KEY = "marginSplitCalc_scenarios_v1";

/* --------------------------------- money --------------------------------- */

export const gbp = (n: number) => "£" + Math.round(n || 0).toLocaleString("en-GB");

/** `+value || 0`, the live page's coercion, including NaN and "" to zero. */
export const num = (v: string | number | undefined | null) => Number(v) || 0;

/* ------------------------- dates and working days ------------------------- */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

export function formatDay(d: Date) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Mon–Fri days inclusive between two dates. */
export function workingDays(start: Date, end: Date) {
  let n = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cur <= end) {
    const dow = cur.getDay(); // 0 = Sun … 6 = Sat
    if (dow !== 0 && dow !== 6) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export function parseStart(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export type QuarterSegment = { start: Date; end: Date; label: string; days: number };

export type QuarterInfo = {
  total: number;
  segs: QuarterSegment[];
  qStart: Date;
  qEnd: Date;
};

/** The three months from `start`, and the working days in each. */
export function quarterInfo(start: Date): QuarterInfo {
  const segs: QuarterSegment[] = [];
  for (let i = 0; i < 3; i++) {
    const s = addMonths(start, i);
    const e = addMonths(start, i + 1);
    e.setDate(e.getDate() - 1);
    segs.push({ start: s, end: e, label: MONTHS[s.getMonth()], days: workingDays(s, e) });
  }
  const qEnd = segs[2].end;
  return { total: workingDays(start, qEnd), segs, qStart: start, qEnd };
}

/* -------------------------------- the sums -------------------------------- */

export const periodFactor = (period: Period) => (period === "quarter" ? 1 : 4);

export type StaffRowResult = {
  name: string;
  rate: number;
  m1: number;
  m2: number;
  m3: number;
  days: number;
  cost: number;
  owner: "" | OwnerKey;
  fifty: boolean;
  /** Booked beyond the working days available — flagged, not corrected. */
  overbooked: boolean;
  fiftyDays: number;
  fiftyValue: number;
};

export type MarginResult = {
  quarter: QuarterInfo | null;
  availTotal: number;
  nameA: string;
  nameB: string;
  periodLabel: string;
  quarterRange: string;

  rows: StaffRowResult[];
  revQ: number;
  revAnnualBase: number;
  staffQ: number;
  totalDays: number;

  carryTotal: number;
  invTotal: number;
  debtATotal: number;
  debtBTotal: number;
  debtTotal: number;

  /** Base revenue for the selected view, before carryover. */
  revBase: number;
  rev: number;
  staff: number;
  margin: number;
  marginPc: number;
  net: number;

  fiftyTotal: number;
  half: number;
  credA: number;
  credB: number;
  splitPot: number;

  aPc: number;
  bPc: number;
  shareA: number;
  shareB: number;
  totalA: number;
  totalB: number;
  totalDist: number;
};

export function calculate(state: MarginState, period: Period): MarginResult {
  const pf = periodFactor(period);
  const revQ = num(state.revenue);

  const start = parseStart(state.startDate);
  const quarter = start ? quarterInfo(start) : null;
  const availTotal = quarter ? quarter.total : 0;

  const nameA = state.nameA || "Owner A";
  const nameB = state.nameB || "Owner B";

  let staffQ = 0;
  let totalDays = 0;
  let fiftyTotal = 0;
  const ownerStaffQ: Record<OwnerKey, number> = { A: 0, B: 0 };

  const rows: StaffRowResult[] = state.staff.map((s) => {
    const rate = num(s.rate);
    const m1 = num(s.m1);
    const m2 = num(s.m2);
    const m3 = num(s.m3);
    const days = m1 + m2 + m3;
    const cost = rate * days;
    totalDays += days;

    // Only unassigned lines are a business cost; an owner's line is credited to
    // them off the top instead.
    if (s.owner === "A" || s.owner === "B") ownerStaffQ[s.owner] += cost;
    else staffQ += cost;

    const fiftyDays = availTotal > 0 ? Math.max(0, availTotal - days) : 0;
    const fiftyValue = s.fifty && fiftyDays > 0 ? fiftyDays * rate : 0;
    fiftyTotal += fiftyValue;

    return {
      name: s.name,
      rate,
      m1,
      m2,
      m3,
      days,
      cost,
      owner: s.owner,
      fifty: s.fifty,
      overbooked: availTotal > 0 && days > availTotal,
      fiftyDays,
      fiftyValue,
    };
  });

  const sum = (items: ItemLine[]) => items.reduce((t, i) => t + num(i.amount), 0);
  const carryTotal = sum(state.carry);
  const invTotal = sum(state.inv);
  const debtATotal = sum(state.debtA);
  const debtBTotal = sum(state.debtB);

  // Carryover is a flat amount for the selected view; revenue and staff scale.
  const revBase = revQ * pf;
  const rev = revBase + carryTotal;
  const staff = staffQ * pf;
  const margin = rev - staff;
  const marginPc = rev > 0 ? (margin / rev) * 100 : 0;
  const net = margin - invTotal; // distributable profit — debts are NOT deducted

  const debtTotal = debtATotal + debtBTotal;
  const half = fiftyTotal / 2;
  const credA = ownerStaffQ.A * pf;
  const credB = ownerStaffQ.B * pf;

  // Owner debts, owner staff credits and the 50/50 pool are set aside before
  // the percentage split. What is left is what the shares divide.
  const splitPot = net - debtTotal - fiftyTotal - credA - credB;
  const splitBase = Math.max(0, splitPot);

  const aPc = state.split;
  const bPc = 100 - aPc;
  const shareA = (splitBase * aPc) / 100;
  const shareB = (splitBase * bPc) / 100;
  const totalA = shareA + debtATotal + half + credA;
  const totalB = shareB + debtBTotal + half + credB;

  return {
    quarter,
    availTotal,
    nameA,
    nameB,
    periodLabel: period === "quarter" ? "per quarter" : "per year",
    quarterRange: quarter
      ? `${formatDay(quarter.qStart)} – ${formatDay(quarter.qEnd)}`
      : "set a start date",

    rows,
    revQ,
    revAnnualBase: revQ * 4,
    staffQ,
    totalDays,

    carryTotal,
    invTotal,
    debtATotal,
    debtBTotal,
    debtTotal,

    revBase,
    rev,
    staff,
    margin,
    marginPc,
    net,

    fiftyTotal,
    half,
    credA,
    credB,
    splitPot,

    aPc,
    bPc,
    shareA,
    shareB,
    totalA,
    totalB,
    totalDist: totalA + totalB,
  };
}

/* --------------------------- editor <-> storage --------------------------- */

let seq = 0;
const nextId = () => `m${++seq}`;

export function toLines(items: StoredItem[] | undefined): ItemLine[] {
  return (items ?? []).map((i) => ({
    id: nextId(),
    name: i.name ?? "",
    amount: i.amount === undefined || i.amount === null ? "" : String(i.amount),
  }));
}

export function blankStaff(): StaffLine {
  return { id: nextId(), name: "Staff", rate: "0", m1: "0", m2: "0", m3: "0", fifty: false, owner: "" };
}

export function blankItem(): ItemLine {
  return { id: nextId(), name: "", amount: "" };
}

/** A stored snapshot — from localStorage, a scenario, or PRESET — as editor state. */
export function fromStored(stored: StoredState): MarginState {
  const staff = stored.staff && stored.staff.length ? stored.staff : PRESET.staff;
  return {
    startDate: stored.startDate ?? "",
    revenue: stored.revenue === undefined || stored.revenue === null ? "" : String(stored.revenue),
    split: stored.split ?? 25,
    nameA: stored.nameA || "Owner A",
    nameB: stored.nameB || "Owner B",
    staff: staff.map((s) => ({
      id: nextId(),
      name: s.name ?? "",
      rate: String(s.rate ?? 0),
      m1: String(s.m1 ?? 0),
      m2: String(s.m2 ?? 0),
      m3: String(s.m3 ?? 0),
      fifty: !!s.fifty,
      owner: s.owner === "A" || s.owner === "B" ? s.owner : "",
    })),
    carry: toLines(stored.carry),
    inv: toLines(stored.inv),
    debtA: toLines(stored.debtA),
    debtB: toLines(stored.debtB),
  };
}

/**
 * Back to the shape the live page reads and writes, so a browser that has both
 * open sees the same saved values under the same key.
 */
export function toStored(state: MarginState): StoredState {
  const items = (list: ItemLine[]): StoredItem[] =>
    list.map((i) => ({ name: i.name, amount: i.amount }));
  return {
    startDate: state.startDate,
    revenue: num(state.revenue),
    split: state.split,
    nameA: state.nameA,
    nameB: state.nameB,
    staff: state.staff.map((s) => ({
      name: s.name,
      rate: num(s.rate),
      m1: num(s.m1),
      m2: num(s.m2),
      m3: num(s.m3),
      fifty: s.fifty,
      owner: s.owner,
    })),
    carry: items(state.carry),
    inv: items(state.inv),
    debtA: items(state.debtA),
    debtB: items(state.debtB),
  };
}

export const clampSplit = (v: number) => Math.max(0, Math.min(100, Math.round(v) || 0));

/* -------------------------------- scenarios ------------------------------- */

export type Scenario = { id: string; name: string; savedAt: string; data: StoredState };

export function formatStamp(iso: string) {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      " " +
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return iso;
  }
}

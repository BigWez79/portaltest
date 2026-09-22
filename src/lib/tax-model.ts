/**
 * Tax Breakdown — the sums, with no DOM in sight.
 *
 * Ported from `taxbreakdown.html` on the live suite (557 lines, read
 * 12 September). The arithmetic is a straight transcription of that page's tax
 * engine: `corpTax`, `taxSlice`, `personalAllowance`, `personalTax`,
 * `employerNI`, `mileageClaim` and `takeHomePct` were already pure functions of
 * their arguments there, so they moved across unchanged.
 *
 * Three things are deliberate and must not be "tidied":
 *
 *   1. **The rates are UK statutory rates and come across exactly as they are.**
 *      Corporation Tax 19%/25% with marginal relief of 3/200, a personal
 *      allowance of £12,570 tapering above £100,000, dividend rates of
 *      10.75%/35.75%/39.35% with a £500 allowance, employee NI 8%/2%, employer
 *      NI 15% above £5,000, HMRC AMAP mileage. They are public, and they are the
 *      entire point of the calculator. The placeholder rule in TASKS.md applies
 *      to default *inputs*, not to these.
 *   2. **Other PAYE income is stacked first** when working out bands and the
 *      personal allowance taper, then subtracted again, so this company's salary
 *      is taxed in the bands the other job leaves free. Employee NI is still
 *      per-employment, which is what HMRC does.
 *   3. **`-0` reaches the screen** wherever a zero is negated for the ledger —
 *      `£-0` rather than `£0`. That is the live page's output, character for
 *      character, and `tests/tax-breakdown.spec.ts` pins it. `fmtSigned` tests
 *      `n < 0`, which is false for `-0`, so `-0` falls through to `fmt` and
 *      `(-0).toLocaleString()` writes the sign. Making it pretty would make the
 *      port disagree with the page it replaces.
 *
 * No "server-only" here: this runs in the browser, and it touches nothing but
 * numbers.
 */

/* ------------------------------ statutory rates ---------------------------- */

/** Corporation Tax, 2026/27. */
const CT_LOWER = 50000;
const CT_UPPER = 250000;
const CT_MAIN_RATE = 0.25;
const CT_SMALL_RATE = 0.19;
const CT_MARGINAL_FRACTION = 3 / 200;

/** Income tax, 2026/27. */
const PERSONAL_ALLOWANCE = 12570;
const TAPER_FROM = 100000;
const BASIC_RATE_TOP = 50270;
const HIGHER_RATE_TOP = 125140;
const SALARY_RATES = [0, 0.2, 0.4, 0.45];

/** Dividends, 2026/27. */
const DIVIDEND_ALLOWANCE = 500;
const DIVIDEND_RATES = [0, 0.1075, 0.3575, 0.3935];

/** National Insurance, 2026/27. */
const EMPLOYEE_NI_THRESHOLDS = [12570, 50270, Infinity];
const EMPLOYEE_NI_RATES = [0, 0.08, 0.02];
const EMPLOYER_NI_THRESHOLD = 5000;
const EMPLOYER_NI_RATE = 0.15;
const EMPLOYMENT_ALLOWANCE_CAP = 10500;

/** The tax year this page's rates belong to, shown on the toolbar. */
export const TAX_YEAR = "2026/27";

/* -------------------------------- the sums -------------------------------- */

export type CorpTax = {
  tax: number;
  rate: number;
  marginalRelief: number;
  band: string;
};

export function corpTax(profit: number): CorpTax {
  if (profit <= 0) return { tax: 0, rate: 0, marginalRelief: 0, band: "None (no profit)" };
  if (profit <= CT_LOWER) {
    return {
      tax: profit * CT_SMALL_RATE,
      rate: CT_SMALL_RATE,
      marginalRelief: 0,
      band: "Small profits rate (19%)",
    };
  }
  if (profit >= CT_UPPER) {
    return { tax: profit * CT_MAIN_RATE, rate: CT_MAIN_RATE, marginalRelief: 0, band: "Main rate (25%)" };
  }
  const mr = (CT_UPPER - profit) * CT_MARGINAL_FRACTION;
  const tax = profit * CT_MAIN_RATE - mr;
  return { tax, rate: tax / profit, marginalRelief: mr, band: "Marginal relief band" };
}

/**
 * Tax on `amount` of income sitting on top of `startPoint` of income already
 * used up, against a band ladder. `thresholds[i]` is the top of band `i`.
 */
export function taxSlice(
  startPoint: number,
  amount: number,
  thresholds: number[],
  rates: number[],
): number {
  let remaining = amount;
  let pos = startPoint;
  let tax = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (remaining <= 0) break;
    const bandTop = thresholds[i];
    if (pos < bandTop) {
      const bandAmount = Math.min(remaining, bandTop - pos);
      tax += bandAmount * rates[i];
      pos += bandAmount;
      remaining -= bandAmount;
    }
  }
  return tax;
}

/** £12,570, withdrawn £1 for every £2 of total income above £100,000. */
export function personalAllowance(totalIncome: number): number {
  if (totalIncome <= TAPER_FROM) return PERSONAL_ALLOWANCE;
  return Math.max(0, PERSONAL_ALLOWANCE - (totalIncome - TAPER_FROM) / 2);
}

export type PersonalTax = { incomeTax: number; dividendTax: number; employeeNI: number };

/**
 * One director's personal tax.
 *
 * `otherPAYEIncome` is a job outside this company. It is not in these accounts,
 * but it uses up bands and drags the personal allowance down, so it is stacked
 * first and then netted off — the difference is what this company's salary
 * costs in income tax. Employee NI is worked out per employment, so it ignores
 * the other job entirely.
 */
export function personalTax(
  salaryThisCo: number,
  otherPAYEIncome: number,
  dividends: number,
): PersonalTax {
  const totalIncome = salaryThisCo + otherPAYEIncome + dividends;
  const pa = personalAllowance(totalIncome);
  const thresholds = [pa, BASIC_RATE_TOP, HIGHER_RATE_TOP, Infinity];

  const taxOnOtherAlone = taxSlice(0, otherPAYEIncome, thresholds, SALARY_RATES);
  const taxOnOtherPlusSalary = taxSlice(
    0,
    otherPAYEIncome + salaryThisCo,
    thresholds,
    SALARY_RATES,
  );
  const incomeTax = taxOnOtherPlusSalary - taxOnOtherAlone;

  const divAllowance = Math.min(DIVIDEND_ALLOWANCE, dividends);
  const divTaxable = dividends - divAllowance;
  const dividendTax = taxSlice(
    otherPAYEIncome + salaryThisCo + divAllowance,
    divTaxable,
    thresholds,
    DIVIDEND_RATES,
  );

  const employeeNI = taxSlice(0, salaryThisCo, EMPLOYEE_NI_THRESHOLDS, EMPLOYEE_NI_RATES);

  return { incomeTax, dividendTax, employeeNI };
}

export function employerNI(salary: number): number {
  return Math.max(0, salary - EMPLOYER_NI_THRESHOLD) * EMPLOYER_NI_RATE;
}

/** HMRC AMAP: the higher rate for the first 10,000 business miles, then the lower. */
export function mileageClaim(miles: number, rateFirst: number, rateAfter: number): number {
  const first = Math.min(miles, 10000);
  const rest = Math.max(0, miles - 10000);
  return first * rateFirst + rest * rateAfter;
}

/**
 * How much of what a director was paid they keep. The `|| 1` guards a director
 * with neither salary nor dividends; it is the live page's guard, kept so the
 * bar behaves the same.
 */
export function takeHomePct(takeHome: number, salary: number, dividend: number): number {
  return (takeHome / (salary + dividend || 1)) * 100;
}

/* --------------------------------- money ---------------------------------- */

export const fmt = (n: number) =>
  "£" + Math.round(n).toLocaleString("en-GB", { maximumFractionDigits: 0 });

/** See note 3 at the top: `-0` is not less than zero, so it prints as `£-0`. */
export const fmtSigned = (n: number) => (n < 0 ? "-" + fmt(Math.abs(n)) : fmt(n));

/** `Number(value) || 0`, the live page's coercion, including "" and NaN to zero. */
export const num = (v: string | number | undefined | null) => Number(v) || 0;

/* ---------------------------------- state --------------------------------- */

/** Exactly what the live page writes to localStorage, key for key. */
export type StoredInputs = {
  companyName: string;
  revenue: number;
  generalExpenses: number;
  travelExpenses: number;
  otherExpenses: number;
  nameA: string;
  salaryA: number;
  pensionA: number;
  milesA: number;
  otherIncomeA: number;
  nameB: string;
  salaryB: number;
  pensionB: number;
  milesB: number;
  otherIncomeB: number;
  mileageRateFirst: number;
  mileageRateAfter: number;
  employmentAllowance: boolean;
  payoutPct: number;
  splitA: number;
};

/**
 * What the editor holds. The money fields are strings so a box can be empty
 * while somebody is typing in it, exactly as an `<input type=number>` behaves;
 * the sums coerce with the same `Number(v) || 0` the live page uses. The two
 * sliders cannot be empty, so they stay numbers.
 */
export type TaxState = {
  companyName: string;
  revenue: string;
  generalExpenses: string;
  travelExpenses: string;
  otherExpenses: string;
  nameA: string;
  salaryA: string;
  pensionA: string;
  milesA: string;
  otherIncomeA: string;
  nameB: string;
  salaryB: string;
  pensionB: string;
  milesB: string;
  otherIncomeB: string;
  mileageRateFirst: string;
  mileageRateAfter: string;
  employmentAllowance: boolean;
  payoutPct: number;
  splitA: number;
};

/** The one browser-storage key, unchanged from the live page. */
export const STORAGE_KEY = "paTaxBreakdownInputs_v1";

/* ---------------------------------------------------------------------------
   Default inputs
   ---------------------------------------------------------------------------

   Placeholders, not this company's figures. The live page ships a revenue, three
   expense lines and two pension contributions that read as a real set of
   accounts, on a page in a public repository — TASKS.md's placeholder rule
   covers exactly that. What is *not* changed is anything statutory: the mileage
   rates are HMRC AMAP, and the £12,570 salary is the personal allowance itself,
   which is the whole point of the default and is already printed on the page.
   --------------------------------------------------------------------------- */
export const DEFAULTS: StoredInputs = {
  companyName: "Example Company Limited",
  revenue: 200000,
  generalExpenses: 20000,
  travelExpenses: 5000,
  otherExpenses: 5000,
  nameA: "Director A",
  salaryA: 12570,
  pensionA: 5000,
  milesA: 0,
  otherIncomeA: 0,
  nameB: "Director B",
  salaryB: 12570,
  pensionB: 5000,
  milesB: 0,
  otherIncomeB: 0,
  mileageRateFirst: 45,
  mileageRateAfter: 25,
  employmentAllowance: true,
  payoutPct: 100,
  splitA: 50,
};

const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

/** A stored snapshot — from localStorage or DEFAULTS — as editor state. */
export function fromStored(stored: Partial<StoredInputs>): TaxState {
  const merged = { ...DEFAULTS, ...stored };
  const s = (v: number | string) => String(v ?? "");
  return {
    companyName: String(merged.companyName ?? ""),
    revenue: s(merged.revenue),
    generalExpenses: s(merged.generalExpenses),
    travelExpenses: s(merged.travelExpenses),
    otherExpenses: s(merged.otherExpenses),
    nameA: String(merged.nameA ?? ""),
    salaryA: s(merged.salaryA),
    pensionA: s(merged.pensionA),
    milesA: s(merged.milesA),
    otherIncomeA: s(merged.otherIncomeA),
    nameB: String(merged.nameB ?? ""),
    salaryB: s(merged.salaryB),
    pensionB: s(merged.pensionB),
    milesB: s(merged.milesB),
    otherIncomeB: s(merged.otherIncomeB),
    mileageRateFirst: s(merged.mileageRateFirst),
    mileageRateAfter: s(merged.mileageRateAfter),
    employmentAllowance: !!merged.employmentAllowance,
    payoutPct: clampPct(merged.payoutPct),
    splitA: clampPct(merged.splitA),
  };
}

/**
 * Back to the shape the live page reads and writes, under the same key, so a
 * browser that has used that page keeps its figures.
 */
export function toStored(state: TaxState): StoredInputs {
  return {
    companyName: state.companyName,
    revenue: num(state.revenue),
    generalExpenses: num(state.generalExpenses),
    travelExpenses: num(state.travelExpenses),
    otherExpenses: num(state.otherExpenses),
    nameA: state.nameA,
    salaryA: num(state.salaryA),
    pensionA: num(state.pensionA),
    milesA: num(state.milesA),
    otherIncomeA: num(state.otherIncomeA),
    nameB: state.nameB,
    salaryB: num(state.salaryB),
    pensionB: num(state.pensionB),
    milesB: num(state.milesB),
    otherIncomeB: num(state.otherIncomeB),
    mileageRateFirst: num(state.mileageRateFirst),
    mileageRateAfter: num(state.mileageRateAfter),
    employmentAllowance: state.employmentAllowance,
    payoutPct: state.payoutPct,
    splitA: state.splitA,
  };
}

/* ------------------------------- the result ------------------------------- */

export type LedgerLine = { label: string; value: number; subtotal: boolean };

export type DirectorResult = {
  name: string;
  salary: number;
  pension: number;
  otherIncome: number;
  mileage: number;
  dividend: number;
  tax: PersonalTax;
  takeHome: number;
  takeHomePct: number;
};

export type TaxResult = {
  grossEmployerNI: number;
  employmentAllowanceApplied: number;
  netEmployerNI: number;
  totalSalaries: number;
  totalPension: number;
  totalMileage: number;
  profitBeforeTax: number;
  ct: CorpTax;
  profitAfterTax: number;
  dividendPool: number;
  retainedProfit: number;
  totalPersonalTax: number;
  totalTax: number;
  effectiveRate: number;
  combinedTakeHome: number;
  ledger: LedgerLine[];
  directors: [DirectorResult, DirectorResult];
};

export function calculate(state: TaxState): TaxResult {
  const revenue = num(state.revenue);
  const generalExpenses = num(state.generalExpenses);
  const travelExpenses = num(state.travelExpenses);
  const otherExpenses = num(state.otherExpenses);
  const salaryA = num(state.salaryA);
  const salaryB = num(state.salaryB);
  const pensionA = num(state.pensionA);
  const pensionB = num(state.pensionB);

  const grossEmployerNI = employerNI(salaryA) + employerNI(salaryB);
  const employmentAllowanceApplied = state.employmentAllowance
    ? Math.min(EMPLOYMENT_ALLOWANCE_CAP, grossEmployerNI)
    : 0;
  const netEmployerNI = grossEmployerNI - employmentAllowanceApplied;

  const totalSalaries = salaryA + salaryB;
  const totalPension = pensionA + pensionB;

  const rateFirst = num(state.mileageRateFirst) / 100;
  const rateAfter = num(state.mileageRateAfter) / 100;
  const mileageA = mileageClaim(num(state.milesA), rateFirst, rateAfter);
  const mileageB = mileageClaim(num(state.milesB), rateFirst, rateAfter);
  const totalMileage = mileageA + mileageB;

  const profitBeforeTax =
    revenue -
    generalExpenses -
    travelExpenses -
    otherExpenses -
    totalSalaries -
    netEmployerNI -
    totalPension -
    totalMileage;

  const ct = corpTax(Math.max(0, profitBeforeTax));
  const profitAfterTax = Math.max(0, profitBeforeTax - ct.tax);

  const dividendPool = profitAfterTax * (state.payoutPct / 100);
  const dividendA = dividendPool * (state.splitA / 100);
  const dividendB = dividendPool * (1 - state.splitA / 100);

  const taxA = personalTax(salaryA, num(state.otherIncomeA), dividendA);
  const taxB = personalTax(salaryB, num(state.otherIncomeB), dividendB);

  const takeHomeA = salaryA - taxA.employeeNI - taxA.incomeTax + dividendA - taxA.dividendTax;
  const takeHomeB = salaryB - taxB.employeeNI - taxB.incomeTax + dividendB - taxB.dividendTax;

  const totalPersonalTax =
    taxA.incomeTax +
    taxA.dividendTax +
    taxA.employeeNI +
    taxB.incomeTax +
    taxB.dividendTax +
    taxB.employeeNI;
  const totalTax = ct.tax + netEmployerNI + totalPersonalTax;
  const retainedProfit = profitAfterTax - dividendPool;
  const effectiveRate = revenue > 0 ? (totalTax / revenue) * 100 : 0;

  const ledger: LedgerLine[] = [
    { label: "Revenue", value: revenue, subtotal: true },
    { label: "General expenses", value: -generalExpenses, subtotal: false },
    { label: "Travel expenses (hotels, other)", value: -travelExpenses, subtotal: false },
    { label: "Mileage allowance (both directors)", value: -totalMileage, subtotal: false },
    { label: "Other allowable expenses", value: -otherExpenses, subtotal: false },
    { label: "Director salaries", value: -totalSalaries, subtotal: false },
    { label: "Employer NI (net of allowance)", value: -netEmployerNI, subtotal: false },
    { label: "Employer pension contributions", value: -totalPension, subtotal: false },
    { label: "Profit before Corporation Tax", value: profitBeforeTax, subtotal: true },
    { label: "Corporation Tax", value: -ct.tax, subtotal: false },
    { label: "Profit after tax", value: profitAfterTax, subtotal: true },
    { label: "Dividends declared", value: -dividendPool, subtotal: false },
    { label: "Retained in company", value: retainedProfit, subtotal: true },
  ];

  const director = (
    name: string,
    fallback: string,
    salary: number,
    pension: number,
    otherIncome: number,
    mileage: number,
    dividend: number,
    tax: PersonalTax,
    takeHome: number,
  ): DirectorResult => ({
    name: name || fallback,
    salary,
    pension,
    otherIncome,
    mileage,
    dividend,
    tax,
    takeHome,
    takeHomePct: takeHomePct(takeHome, salary, dividend),
  });

  return {
    grossEmployerNI,
    employmentAllowanceApplied,
    netEmployerNI,
    totalSalaries,
    totalPension,
    totalMileage,
    profitBeforeTax,
    ct,
    profitAfterTax,
    dividendPool,
    retainedProfit,
    totalPersonalTax,
    totalTax,
    effectiveRate,
    combinedTakeHome: takeHomeA + takeHomeB,
    ledger,
    directors: [
      director(
        state.nameA,
        "Director",
        salaryA,
        pensionA,
        num(state.otherIncomeA),
        mileageA,
        dividendA,
        taxA,
        takeHomeA,
      ),
      director(
        state.nameB,
        "Director",
        salaryB,
        pensionB,
        num(state.otherIncomeB),
        mileageB,
        dividendB,
        taxB,
        takeHomeB,
      ),
    ],
  };
}

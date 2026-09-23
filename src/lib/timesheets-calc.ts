/**
 * Timesheets — the shapes and the arithmetic, with no server in them.
 *
 * Split from timesheets.ts so the browser can total a day as somebody types.
 * timesheets.ts is `server-only`; importing it from a client component would
 * drag the Supabase client into the browser bundle.
 */

export type TimesheetEntry = {
  id: string;
  staffEmail: string;
  staffName: string | null;
  entryDate: string; // YYYY-MM-DD
  activityType: string;
  project: string | null;
  hoursWorked: number;
  workDescription: string | null;
  claimMonth: string; // YYYY-MM
  submittedOn: string;
};

/** Carried across from the live page unchanged — people know these words. */
export const ACTIVITY_TYPES = [
  "Meeting",
  "Project work",
  "Routine / BAU",
  "Training",
  "Development",
  "Demo",
  "Admin",
  "Adhoc",
  "Other",
  "Annual Leave",
  "Sick",
] as const;

/**
 * Leave and sickness are a whole day, not an amount of work. The live page
 * fixes them at eight hours and hides the hours box, so the number logged is
 * the same for everybody rather than whatever each person decides a day is.
 */
export const FULL_DAY_TYPES = new Set<string>(["Annual Leave", "Sick"]);
export const FULL_DAY_HOURS = 8;

export const isFullDay = (type: string) => FULL_DAY_TYPES.has(type);

/** What a row's hours should be, given its type. */
export function hoursFor(type: string, typed: number): number {
  return isFullDay(type) ? FULL_DAY_HOURS : typed;
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/* -------------------------------------------------------------------------
   Grouping
   ------------------------------------------------------------------------- */

export type Day = { date: string; entries: TimesheetEntry[]; hours: number };
export type Month = { month: string; days: Day[]; hours: number; billable: number };

/**
 * Hours that represent work, as opposed to hours somebody was away. The month
 * total counts everything logged; this counts what was actually worked, and
 * they are different numbers people need for different reasons.
 */
export function billableHours(entries: TimesheetEntry[]): number {
  return round2(
    entries.filter((e) => !isFullDay(e.activityType)).reduce((sum, e) => sum + e.hoursWorked, 0),
  );
}

export function groupByMonth(entries: TimesheetEntry[]): Month[] {
  const months = new Map<string, Map<string, TimesheetEntry[]>>();

  for (const e of entries) {
    const days = months.get(e.claimMonth) ?? new Map<string, TimesheetEntry[]>();
    const list = days.get(e.entryDate) ?? [];
    list.push(e);
    days.set(e.entryDate, list);
    months.set(e.claimMonth, days);
  }

  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, days]) => {
      const dayList: Day[] = [...days.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, list]) => ({
          date,
          entries: list,
          hours: round2(list.reduce((s, e) => s + e.hoursWorked, 0)),
        }));
      const all = dayList.flatMap((d) => d.entries);
      return {
        month,
        days: dayList,
        hours: round2(all.reduce((s, e) => s + e.hoursWorked, 0)),
        billable: billableHours(all),
      };
    });
}

export const monthName = (m: string) =>
  m
    ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

export const dayName = (d: string) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";

export function toEntry(row: Record<string, unknown>): TimesheetEntry {
  const date = String(row.entry_date ?? "");
  return {
    id: String(row.id),
    staffEmail: String(row.staff_email ?? "").toLowerCase(),
    staffName: (row.staff_name as string) ?? null,
    entryDate: date,
    activityType: String(row.activity_type ?? "Other"),
    project: (row.project as string) ?? null,
    hoursWorked: Number(row.hours_worked ?? 0),
    workDescription: (row.work_description as string) ?? null,
    claimMonth: String(row.claim_month ?? date.slice(0, 7)),
    submittedOn: String(row.submitted_on ?? ""),
  };
}

export type EntryInput = {
  entryDate: string;
  activityType: string;
  project: string;
  hoursWorked: number;
  workDescription: string;
};

/* -------------------------------------------------------------------------
   Month, or financial year
   ------------------------------------------------------------------------- */

export type Period = "month" | "year";

/** A period that has already been turned into an invoice. */
export type TimesheetIssue = { claimMonth: string; invoiceId: string; issuedAt: string };

/**
 * The UK financial year a date falls in, as the year it starts.
 *
 * From 6 April, not 1 April and not 1 January. 5 April 2027 is in 2026-27;
 * 6 April 2027 starts the next one. Getting this wrong by a day puts a week of
 * somebody's work in the wrong statement, and the boundary is the only part
 * anybody ever gets wrong — so it is one function, tested at both sides of it.
 */
export function financialYearOf(date: string): number {
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return NaN;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return month > 4 || (month === 4 && day >= 6) ? d.getFullYear() : d.getFullYear() - 1;
}

/** "2026-27", how a financial year is written down. */
export const financialYearLabel = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, "0")}`;

/** Whether a date is inside a period — a month like "2026-07", or a FY start. */
export function inPeriod(date: string, period: Period, key: string): boolean {
  return period === "month" ? date.slice(0, 7) === key : financialYearOf(date) === Number(key);
}

/** The periods these entries actually cover, newest first. */
export function periodsFor(entries: TimesheetEntry[], period: Period): string[] {
  const keys = entries.map((e) =>
    period === "month" ? e.entryDate.slice(0, 7) : String(financialYearOf(e.entryDate)),
  );
  return [...new Set(keys)].sort((a, b) => b.localeCompare(a));
}

export const periodLabel = (period: Period, key: string) =>
  period === "month" ? monthName(key) : `Financial year ${financialYearLabel(Number(key))}`;

/** What a period's worth of days is billed at, given a day rate. */
export function daysWorked(entries: TimesheetEntry[]): number {
  const byDay = new Map<string, number>();
  for (const e of entries) {
    if (isFullDay(e.activityType)) continue;
    byDay.set(e.entryDate, (byDay.get(e.entryDate) ?? 0) + e.hoursWorked);
  }
  // A day is a day. The live page bills whole days rather than hours, so a
  // seven-hour day and a nine-hour day are both one — and a day with nothing
  // billable on it is none.
  let days = 0;
  for (const hours of byDay.values()) if (hours > 0) days += 1;
  return days;
}

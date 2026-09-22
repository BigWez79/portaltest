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

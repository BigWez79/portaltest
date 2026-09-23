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

/* -------------------------------------------------------------------------
   The team calendar
   ------------------------------------------------------------------------- */

/**
 * A colour per activity, read off the live Monthly Overview.
 *
 * Kept exactly, because somebody looking at this beside a printout from the old
 * page should not have to work out whether the colours mean the same thing.
 *
 * The two that matter are the last two: Annual Leave orange and Sick red, so
 * absence stands out from every shade of work. That is what an admin opens this
 * page to see — the rest of the palette only has to be distinguishable.
 */
export const ACTIVITY_COLOURS: Record<string, string> = {
  Meeting: "#4E79C6",
  "Project work": "#3F9E68",
  "Routine / BAU": "#7FB069",
  Training: "#8E7CC3",
  Development: "#D26FA0",
  Demo: "#3FB0B0",
  Admin: "#6B8CAE",
  Adhoc: "#C9A24B",
  Other: "#9AA3B8",
  "Annual Leave": "#F2933C",
  Sick: "#E03131",
};

export const FALLBACK_COLOUR = "#9aa3bd";

export const colourFor = (activity: string) => ACTIVITY_COLOURS[activity] ?? FALLBACK_COLOUR;

export type GridPerson = {
  email: string;
  name: string;
  /** date -> activity -> hours */
  days: Record<string, Record<string, number>>;
  total: number;
};

export type TeamGrid = {
  /** Working days only, Monday to Friday. */
  days: string[];
  people: GridPerson[];
  /** activity -> hours across everybody */
  activityTotals: [string, number][];
  grand: number;
  /** The busiest single day anybody had, for scaling the bars. */
  maxDaily: number;
};

/**
 * Everybody's month, as the live page draws it.
 *
 * Weekends are left out rather than shown empty. A month is 20-odd working days
 * and 30-odd columns; the eight that are always blank cost a fifth of the width
 * and say nothing, and on a phone that is the difference between readable and
 * not.
 */
export function buildTeamGrid(entries: TimesheetEntry[], month: string): TeamGrid {
  const [y, m] = month.split("-").map(Number);
  const days: string[] = [];
  if (Number.isFinite(y) && Number.isFinite(m)) {
    const count = new Date(y, m, 0).getDate();
    for (let d = 1; d <= count; d++) {
      const date = new Date(y, m - 1, d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue;
      days.push(`${month}-${String(d).padStart(2, "0")}`);
    }
  }

  const byPerson = new Map<string, GridPerson>();
  const activityTotals = new Map<string, number>();
  let grand = 0;

  for (const e of entries) {
    if (e.claimMonth !== month) continue;
    const email = e.staffEmail.toLowerCase();
    if (!email) continue;

    if (!byPerson.has(email)) {
      byPerson.set(email, { email, name: e.staffName || email, days: {}, total: 0 });
    }
    const person = byPerson.get(email)!;
    person.days[e.entryDate] = person.days[e.entryDate] ?? {};
    person.days[e.entryDate][e.activityType] =
      (person.days[e.entryDate][e.activityType] ?? 0) + e.hoursWorked;
    person.total += e.hoursWorked;

    activityTotals.set(e.activityType, (activityTotals.get(e.activityType) ?? 0) + e.hoursWorked);
    grand += e.hoursWorked;
  }

  let maxDaily = 0;
  for (const person of byPerson.values()) {
    for (const day of Object.values(person.days)) {
      const total = Object.values(day).reduce((a, b) => a + b, 0);
      if (total > maxDaily) maxDaily = total;
    }
  }

  return {
    days,
    people: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)),
    activityTotals: [...activityTotals.entries()].sort((a, b) => b[1] - a[1]),
    grand,
    // Never zero: the bars divide by it, and an empty month would otherwise
    // make every height NaN rather than simply drawing nothing.
    maxDaily: maxDaily > 0 ? maxDaily : FULL_DAY_HOURS,
  };
}

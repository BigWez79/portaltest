"use server";

import { revalidatePath } from "next/cache";
import { getProfile, saveProfile } from "@/lib/profile";
import { addLine, createInvoice, listInvoices, nextInvoiceNo, DEFAULT_TAX_RATE } from "@/lib/invoices";
import { getCurrentUser } from "@/lib/current-user";
import { resolveAccess } from "@/lib/staff";
import {
  ACTIVITY_TYPES,
  addEntry,
  entriesOnDay,
  hoursFor,
  isFullDay,
  issuedPeriods,
  listEntries,
  lockMonth,
  lockedMonths,
  recordIssue,
  removeEntry,
  replaceDay,
  type EntryInput,
  type TimesheetEntry,
} from "@/lib/timesheets";

export type TimesheetState = { status: "idle" | "ok" | "error"; message?: string };

/**
 * Every action re-checks the caller. A server action is a public endpoint —
 * rendering the form is not what stops somebody without the flag posting to it
 * (CLAUDE.md rule 5).
 */
async function requireTimesheets() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const access = await resolveAccess(user);
  if (!access.apps.timesheet) throw new Error("No timesheet access");
  return access;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export async function logHours(
  _previous: TimesheetState,
  formData: FormData,
): Promise<TimesheetState> {
  let access;
  try {
    access = await requireTimesheets();
  } catch {
    return { status: "error", message: "You are not allowed to log hours." };
  }

  const entryDate = String(formData.get("entryDate") ?? "").trim();
  const activityType = String(formData.get("activityType") ?? "").trim();

  if (!DATE.test(entryDate)) return { status: "error", message: "Choose a date." };
  if (!ACTIVITY_TYPES.includes(activityType as (typeof ACTIVITY_TYPES)[number])) {
    return { status: "error", message: "Choose what you were doing." };
  }

  // Leave and sickness are a whole day. Taking the number off the form would
  // let one person's holiday be seven hours and another's nine.
  const typed = Number(formData.get("hoursWorked"));
  const hoursWorked = hoursFor(activityType, typed);

  if (!isFullDay(activityType)) {
    if (!Number.isFinite(typed) || typed <= 0) {
      return { status: "error", message: "Enter the hours worked." };
    }
    if (typed > 24) {
      return { status: "error", message: "A day has 24 hours in it." };
    }
  }

  const result = await addEntry(access.email, access.displayName, {
    entryDate,
    activityType,
    project: String(formData.get("project") ?? "").trim(),
    hoursWorked,
    workDescription: String(formData.get("workDescription") ?? "").trim(),
  });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/timesheets");
  return { status: "ok", message: "Logged." };
}

export async function deleteHours(
  _previous: TimesheetState,
  formData: FormData,
): Promise<TimesheetState> {
  let access;
  try {
    access = await requireTimesheets();
  } catch {
    return { status: "error", message: "You are not allowed to change hours." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Nothing to remove." };

  // The entry has to be this person's. The policy says so too; this is the
  // check that gives a sentence somebody can read rather than a silent no-op.
  const mine = await listEntries(access.email);
  if (!mine.some((e) => e.id === id)) {
    return { status: "error", message: "That entry is not yours." };
  }

  const ok = await removeEntry(id);
  if (!ok) {
    return { status: "error", message: "That could not be removed. The month may be closed." };
  }

  revalidatePath("/timesheets");
  return { status: "ok", message: "Removed." };
}

export async function closeMonth(
  _previous: TimesheetState,
  formData: FormData,
): Promise<TimesheetState> {
  let access;
  try {
    access = await requireTimesheets();
  } catch {
    return { status: "error", message: "You are not allowed to close a month." };
  }

  const month = String(formData.get("month") ?? "");
  if (!MONTH.test(month)) return { status: "error", message: "Choose a month." };

  const ok = await lockMonth(access.email, month);
  if (!ok) return { status: "error", message: "That month could not be closed." };

  revalidatePath("/timesheets");
  return { status: "ok", message: "Month closed. It can no longer be changed." };
}

/**
 * How many activities one day may carry.
 *
 * Not a guess at how somebody works — it is the bound on what a single post can
 * make the server do. A form that can grow without limit is a form somebody can
 * point at this action with ten thousand rows in it.
 */
const MAX_ACTIVITIES = 20;

export async function submitDay(
  _previous: TimesheetState,
  formData: FormData,
): Promise<TimesheetState> {
  let access;
  try {
    access = await requireTimesheets();
  } catch {
    return { status: "error", message: "You are not allowed to log hours." };
  }

  const entryDate = String(formData.get("entryDate") ?? "").trim();
  if (!DATE.test(entryDate)) return { status: "error", message: "Choose a date." };

  // The form posts one set of parallel arrays, so an activity is a row across
  // them. Read from the types: a row without one is a row that was removed on
  // screen and left its empty inputs behind.
  const types = formData.getAll("activityType").map((v) => String(v).trim());
  const projects = formData.getAll("project").map((v) => String(v));
  const hours = formData.getAll("hoursWorked").map((v) => String(v));
  const notes = formData.getAll("workDescription").map((v) => String(v));

  const activities: EntryInput[] = [];
  for (let i = 0; i < types.length; i++) {
    const activityType = types[i];
    if (!activityType) continue;

    if (!ACTIVITY_TYPES.includes(activityType as (typeof ACTIVITY_TYPES)[number])) {
      return { status: "error", message: "Choose what you were doing." };
    }

    // Leave and sickness are a whole day. Taking the number off the form would
    // let one person's holiday be seven hours and another's nine.
    const typed = Number(hours[i]);
    if (!isFullDay(activityType)) {
      if (!Number.isFinite(typed) || typed <= 0) {
        return { status: "error", message: "Enter the hours for every activity." };
      }
      if (typed > 24) return { status: "error", message: "A day has 24 hours in it." };
    }

    activities.push({
      entryDate,
      activityType,
      project: (projects[i] ?? "").trim(),
      hoursWorked: hoursFor(activityType, typed),
      workDescription: (notes[i] ?? "").trim(),
    });
  }

  if (activities.length === 0) {
    return { status: "error", message: "Add at least one activity to the day." };
  }
  if (activities.length > MAX_ACTIVITIES) {
    return { status: "error", message: `A day takes at most ${MAX_ACTIVITIES} activities.` };
  }

  // A full day is the whole day. Logging Annual Leave beside four hours of
  // project work says two contradictory things about the same date, and the
  // one that reaches an invoice depends on which row is read first.
  const full = activities.filter((a) => isFullDay(a.activityType));
  if (full.length > 0 && activities.length > 1) {
    return {
      status: "error",
      message: `${full[0].activityType} is a whole day, so it cannot share the day with anything else.`,
    };
  }

  const total = activities.reduce((sum, a) => sum + a.hoursWorked, 0);
  if (total > 24) return { status: "error", message: "A day has 24 hours in it." };

  const editing = String(formData.get("editing") ?? "") === "yes";
  if (!editing) {
    // Submitting a day that already has activities would silently replace them.
    // Editing is how you change one, and this says so rather than doing it.
    const already = await entriesOnDay(access.email, entryDate);
    if (already.length > 0) {
      return {
        status: "error",
        message: `You already have activities logged for ${entryDate}. Open it from My entries to change them.`,
      };
    }
  }

  const result = await replaceDay(access.email, access.displayName, entryDate, activities);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/timesheets");
  revalidatePath("/overview");
  return {
    status: "ok",
    message: editing ? `${entryDate} updated.` : `${entryDate} submitted.`,
  };
}

export async function deleteDay(
  _previous: TimesheetState,
  formData: FormData,
): Promise<TimesheetState> {
  let access;
  try {
    access = await requireTimesheets();
  } catch {
    return { status: "error", message: "You are not allowed to change hours." };
  }

  const entryDate = String(formData.get("entryDate") ?? "").trim();
  if (!DATE.test(entryDate)) return { status: "error", message: "Nothing to remove." };

  const already = await entriesOnDay(access.email, entryDate);
  if (already.length === 0) return { status: "error", message: "Nothing logged on that day." };

  const result = await replaceDay(access.email, access.displayName, entryDate, []);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/timesheets");
  revalidatePath("/overview");
  return { status: "ok", message: `${entryDate} removed.` };
}

/**
 * The day rate, saved from the Timesheets screen.
 *
 * It lives on the profile — one place for a person's details (rule 10) — but
 * this is where somebody is standing when they think about what a day is worth,
 * which is where the live page puts the button. One column, two ways in.
 */
export async function saveDayRate(
  _previous: TimesheetState,
  formData: FormData,
): Promise<TimesheetState> {
  let access;
  try {
    access = await requireTimesheets();
  } catch {
    return { status: "error", message: "You are not allowed to change this." };
  }

  const raw = String(formData.get("dayRate") ?? "").trim();
  let dayRate: number | null = null;
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100_000) {
      return { status: "error", message: "A day rate is a number of pounds, up to 100,000." };
    }
    dayRate = Math.round(n * 100) / 100;
  }

  // Read, change one field, write back. Saving only the rate would blank every
  // other field on the profile, which is somebody's bank details.
  const current = await getProfile(access.email);
  const { staffEmail: _ignored, ...rest } = current;
  const ok = await saveProfile(access.email, { ...rest, dayRate });
  if (!ok) return { status: "error", message: "That could not be saved." };

  revalidatePath("/timesheets");
  revalidatePath("/profile");
  return { status: "ok", message: dayRate == null ? "Day rate cleared." : "Day rate saved." };
}

/**
 * Turn a closed month into a real invoice.
 *
 * TWO APPS, TWO FLAGS. Issuing reads a timesheet and writes an invoice, so the
 * caller needs both — a person with timesheets alone gets no button and, more
 * to the point, no action either (rule 5). The live page had one login for
 * everything and never had to answer this.
 *
 * Only a closed month. Closing is how a month is declared final; billing one
 * that is still open means invoicing a figure that can still change, and the
 * customer has already got the document by the time it does.
 */
export async function issueTimesheetInvoice(
  _previous: TimesheetState,
  formData: FormData,
): Promise<TimesheetState> {
  let access;
  try {
    access = await requireTimesheets();
  } catch {
    return { status: "error", message: "You are not allowed to issue invoices." };
  }
  if (!access.apps.invoices) {
    return { status: "error", message: "Issuing an invoice needs access to Invoices." };
  }

  const month = String(formData.get("month") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return { status: "error", message: "Choose a month." };

  const customerId = String(formData.get("customerId") ?? "");
  if (!customerId) return { status: "error", message: "Choose who to invoice." };

  const closed = await lockedMonths(access.email);
  if (!closed.includes(month)) {
    return { status: "error", message: `Close ${month} first. A month is billed once it is final.` };
  }

  const already = await issuedPeriods(access.email);
  if (already.some((i) => i.claimMonth === month)) {
    return { status: "error", message: `${month} has already been invoiced.` };
  }

  const profile = await getProfile(access.email);
  if (profile.dayRate == null) {
    return { status: "error", message: "Set a day rate before invoicing a month." };
  }

  const entries = await listEntries(access.email);
  const inMonth = entries.filter((e) => e.claimMonth === month);
  const days = billableDays(inMonth);
  if (days.length === 0) {
    return { status: "error", message: `Nothing billable in ${month}.` };
  }

  const existing = await listInvoices(access.email);
  const invoiceNo = nextInvoiceNo(
    existing.map((i) => i.invoiceNo),
    profile.issuerPrefix || "PA",
  );

  const created = await createInvoice(
    access.email,
    {
      invoiceNo,
      customerId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      project: `Timesheet ${month}`,
      taxRate: profile.vatRegistered ? DEFAULT_TAX_RATE : 0,
    },
    {
      name: profile.businessName || access.displayName || null,
      address: profile.businessAddress,
      vat: profile.vatRegistered ? profile.vatNumber : null,
      companyNo: profile.companyNumber,
      bankName: profile.accountName,
      sortCode: profile.sortCode,
      accountNo: profile.accountNo,
      tagline: profile.tagline,
      logo: profile.logo,
      paymentTermsDays: profile.paymentTermsDays,
    },
  );
  if (!created.ok) return { status: "error", message: created.message };

  // One line per day, not one line saying "21 days". A customer checking an
  // invoice against their own records needs the dates.
  let position = 0;
  for (const [date, what] of days) {
    const added = await addLine(
      created.id,
      {
        itemNo: date,
        description: what,
        qty: 1,
        unitPrice: profile.dayRate,
      },
      profile.vatRegistered ? DEFAULT_TAX_RATE : 0,
      position++,
    );
    if (!added) {
      return { status: "error", message: `${invoiceNo} was raised but a line failed. Check it.` };
    }
  }

  // Last, and after the invoice exists: if this failed first, the period would
  // be marked billed with no document behind it and could never be billed.
  await recordIssue(access.email, month, created.id);

  revalidatePath("/timesheets");
  revalidatePath("/invoices");
  return { status: "ok", message: `${invoiceNo} raised for ${month} — ${days.length} days.` };
}

/** The billable days in a set of entries, with what was done on each. */
function billableDays(entries: TimesheetEntry[]): [string, string][] {
  const byDay = new Map<string, Set<string>>();
  for (const e of entries) {
    if (isFullDay(e.activityType)) continue;
    if (e.hoursWorked <= 0) continue;
    if (!byDay.has(e.entryDate)) byDay.set(e.entryDate, new Set());
    byDay.get(e.entryDate)!.add(e.project || e.activityType);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, what]) => [date, [...what].join(", ")]);
}

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { resolveAccess } from "@/lib/staff";
import {
  ACTIVITY_TYPES,
  addEntry,
  entriesOnDay,
  hoursFor,
  isFullDay,
  listEntries,
  lockMonth,
  removeEntry,
  replaceDay,
  type EntryInput,
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

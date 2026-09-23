"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { resolveAccess } from "@/lib/staff";
import {
  ACTIVITY_TYPES,
  addEntry,
  hoursFor,
  isFullDay,
  listEntries,
  lockMonth,
  removeEntry,
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

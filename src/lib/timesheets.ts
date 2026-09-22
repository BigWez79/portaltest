import "server-only";
import { staffSource } from "./env";
import { toEntry, type EntryInput, type TimesheetEntry } from "./timesheets-calc";

/**
 * Timesheets — the hours a person logged, and which months are closed.
 *
 * Reads go through the caller's own session so row level security decides what
 * comes back (CLAUDE.md rule 11, and 0006_timesheets.sql). No `.eq()` on
 * staff_email in the read path: a filter here would read like the thing keeping
 * other people's hours out, and the next person to touch it would believe that.
 *
 * The shapes and the arithmetic live in timesheets-calc.ts, which the browser
 * may import. This file may not be.
 */

export * from "./timesheets-calc";

const COLUMNS =
  "id, staff_email, staff_name, entry_date, activity_type, project, hours_worked, work_description, claim_month, submitted_on";

const fixture = () => staffSource() === "fixture";

async function store() {
  const { timesheetStore } = await import("./timesheets-store");
  return timesheetStore;
}

async function client() {
  const { supabaseServer } = await import("./supabase/server");
  return supabaseServer();
}

export async function listEntries(email: string): Promise<TimesheetEntry[]> {
  const key = email.toLowerCase();
  if (!key) return [];
  if (fixture()) return (await store()).entriesFor(key);

  const { data, error } = await (await client())
    .from("timesheet_entries")
    .select(COLUMNS)
    .order("entry_date", { ascending: false });
  if (error) {
    console.error("[timesheets] list failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => toEntry(r as Record<string, unknown>));
}

/**
 * Every entry the caller may read — their own, or everybody's for an active
 * admin. The query is identical either way: the policy decides, not a branch
 * here. The `isAdmin` argument exists only so the fixture store can behave the
 * same way, because a file has no row level security of its own.
 */
export async function listVisibleEntries(
  email: string,
  isAdmin: boolean,
): Promise<TimesheetEntry[]> {
  if (fixture()) {
    const s = await store();
    return isAdmin ? s.allEntries() : s.entriesFor(email.toLowerCase());
  }
  // No branch: "read own entries" and "admins read every entry" are both
  // select policies on the same table, so one query returns the right set.
  return listEntries(email);
}

export async function lockedMonths(email: string): Promise<string[]> {
  const key = email.toLowerCase();
  if (!key) return [];
  if (fixture()) return (await store()).locksFor(key);

  const { data, error } = await (await client())
    .from("timesheet_month_locks")
    .select("claim_month");
  if (error) {
    console.error("[timesheets] locks failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => String((r as Record<string, unknown>).claim_month));
}

export async function addEntry(
  email: string,
  name: string | null,
  input: EntryInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = email.toLowerCase();
  if (fixture()) return (await store()).add(key, name, input);

  const { error } = await (await client()).from("timesheet_entries").insert({
    staff_email: key,
    staff_name: name,
    entry_date: input.entryDate,
    activity_type: input.activityType,
    project: input.project || null,
    hours_worked: input.hoursWorked,
    work_description: input.workDescription || null,
  });
  if (error) {
    console.error("[timesheets] add failed", error.message);
    // A locked month and a policy refusal look the same from here, and the
    // locked month is the one somebody can do something about.
    return { ok: false, message: "That could not be logged. The month may be closed." };
  }
  return { ok: true };
}

export async function removeEntry(id: string): Promise<boolean> {
  if (fixture()) return (await store()).remove(id);

  const { error } = await (await client()).from("timesheet_entries").delete().eq("id", id);
  if (error) {
    console.error("[timesheets] remove failed", error.message);
    return false;
  }
  return true;
}

export async function lockMonth(email: string, month: string): Promise<boolean> {
  const key = email.toLowerCase();
  if (fixture()) return (await store()).lock(key, month);

  const { error } = await (await client())
    .from("timesheet_month_locks")
    .insert({ staff_email: key, claim_month: month });
  if (error) {
    console.error("[timesheets] lock failed", error.message);
    return false;
  }
  return true;
}

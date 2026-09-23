import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  toEntry,
  type EntryInput,
  type TimesheetEntry,
  type TimesheetIssue,
} from "./timesheets-calc";

/**
 * Test-only timesheet store, so the suite can exercise the write path without a
 * live Supabase. Same shape as the staff, expenses and invoice stores: seeded
 * from tests/fixtures into .tmp so a test does not edit a tracked file, saved
 * by rename so parallel workers never read half a document, and named with a
 * random suffix because Next instantiates a module more than once per process.
 *
 * Reachable only when STAFF_SOURCE=fixture.
 *
 * It enforces the month lock itself, duplicating the policy in
 * 0006_timesheets.sql on purpose: a suite that passed against a store which let
 * a closed month be edited would prove nothing about the table that refuses it.
 */

type StoredIssue = {
  staffEmail: string;
  claimMonth: string;
  invoiceId: string;
  issuedAt: string;
};

type Doc = {
  entries: TimesheetEntry[];
  locks: { staffEmail: string; claimMonth: string }[];
  /** Optional: the seed predates 0011 and a missing list means none issued. */
  issues?: StoredIssue[];
};

const SEED = path.join(process.cwd(), "tests", "fixtures", "timesheets.json");
const WORKING = path.join(process.cwd(), ".tmp", "timesheets.json");

function normalise(raw: unknown): Doc {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    entries: ((d.entries as unknown[]) ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      // The seed is in the database's spelling, the working copy in the
      // application's. Mapping a working copy twice looks for snake_case keys
      // that are gone and yields a row belonging to nobody.
      return "staffEmail" in row ? (row as unknown as TimesheetEntry) : toEntry(row);
    }),
    locks: ((d.locks as Doc["locks"]) ?? []).map((l) => ({
      staffEmail: String(l.staffEmail).toLowerCase(),
      claimMonth: String(l.claimMonth),
    })),
    // Carried through every read. Leaving it out here silently dropped the
    // record on the next load: the issue was written, saved, and gone by the
    // time anything asked whether the month had been billed.
    issues: ((d.issues as StoredIssue[]) ?? []).map((i) => ({
      staffEmail: String(i.staffEmail).toLowerCase(),
      claimMonth: String(i.claimMonth),
      invoiceId: String(i.invoiceId),
      issuedAt: String(i.issuedAt),
    })),
  };
}

async function load(): Promise<Doc> {
  try {
    const [seedStat, workingStat] = await Promise.all([stat(SEED), stat(WORKING)]);
    if (seedStat.mtimeMs > workingStat.mtimeMs) throw new Error("seed is newer");
    return normalise(JSON.parse(await readFile(WORKING, "utf8")));
  } catch {
    const seed = normalise(JSON.parse(await readFile(SEED, "utf8")));
    await save(seed);
    return seed;
  }
}

async function save(doc: Doc): Promise<void> {
  await mkdir(path.dirname(WORKING), { recursive: true });
  const pending = `${WORKING}.${randomUUID()}.tmp`;
  await writeFile(pending, JSON.stringify(doc, null, 2), "utf8");
  await rename(pending, WORKING);
}

const isLocked = (doc: Doc, email: string, month: string) =>
  doc.locks.some((l) => l.staffEmail === email && l.claimMonth === month);

export const timesheetStore = {
  async entriesFor(email: string): Promise<TimesheetEntry[]> {
    const doc = await load();
    return doc.entries
      .filter((e) => e.staffEmail === email)
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  },

  /** Every entry, for the overview when an admin is looking. RLS returns the
      same set against the real table through "admins read every entry". */
  async allEntries(): Promise<TimesheetEntry[]> {
    const doc = await load();
    return [...doc.entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  },

  async locksFor(email: string): Promise<string[]> {
    const doc = await load();
    return doc.locks.filter((l) => l.staffEmail === email).map((l) => l.claimMonth);
  },

  async add(
    email: string,
    name: string | null,
    input: EntryInput,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const doc = await load();
    const month = input.entryDate.slice(0, 7);
    if (isLocked(doc, email, month)) {
      return { ok: false, message: "That month is closed and can no longer be changed." };
    }

    doc.entries.push({
      id: randomUUID(),
      staffEmail: email,
      staffName: name,
      entryDate: input.entryDate,
      activityType: input.activityType,
      project: input.project || null,
      hoursWorked: input.hoursWorked,
      workDescription: input.workDescription || null,
      claimMonth: month,
      submittedOn: new Date().toISOString(),
    });
    await save(doc);
    return { ok: true };
  },

  async remove(id: string): Promise<boolean> {
    const doc = await load();
    const row = doc.entries.find((e) => e.id === id);
    if (!row) return false;
    if (isLocked(doc, row.staffEmail, row.claimMonth)) return false;
    doc.entries = doc.entries.filter((e) => e.id !== id);
    await save(doc);
    return true;
  },

  /** Everything on one date, replaced. The delete runs first — see replaceDay. */
  async replaceDay(
    email: string,
    name: string | null,
    date: string,
    activities: EntryInput[],
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const doc = await load();
    const month = date.slice(0, 7);
    if (doc.locks.some((l) => l.staffEmail === email && l.claimMonth === month)) {
      return { ok: false, message: "That month is closed." };
    }

    doc.entries = doc.entries.filter((e) => !(e.staffEmail === email && e.entryDate === date));
    for (const a of activities) {
      doc.entries.push({
        id: randomUUID(),
        staffEmail: email,
        staffName: name,
        entryDate: date,
        activityType: a.activityType,
        project: a.project || null,
        hoursWorked: a.hoursWorked,
        workDescription: a.workDescription || null,
        claimMonth: month,
        submittedOn: new Date().toISOString(),
      });
    }
    await save(doc);
    return { ok: true };
  },

  async lock(email: string, month: string): Promise<boolean> {
    const doc = await load();
    if (isLocked(doc, email, month)) return true;
    doc.locks.push({ staffEmail: email, claimMonth: month });
    await save(doc);
    return true;
  },

  async issuesFor(email: string): Promise<TimesheetIssue[]> {
    const doc = await load();
    return (doc.issues ?? [])
      .filter((i) => i.staffEmail === email)
      .map(({ claimMonth, invoiceId, issuedAt }) => ({ claimMonth, invoiceId, issuedAt }));
  },

  async recordIssue(email: string, claimMonth: string, invoiceId: string): Promise<boolean> {
    const doc = await load();
    doc.issues = doc.issues ?? [];
    // The primary key in 0011 is what actually stops a period being billed
    // twice; this is the same rule where there is no database to enforce it.
    if (doc.issues.some((i) => i.staffEmail === email && i.claimMonth === claimMonth)) {
      return false;
    }
    doc.issues.push({ staffEmail: email, claimMonth, invoiceId, issuedAt: new Date().toISOString() });
    await save(doc);
    return true;
  },

  /** Back to the seed. The suite calls this between write tests. */
  async reset(): Promise<void> {
    await save(normalise(JSON.parse(await readFile(SEED, "utf8"))));
  },
};

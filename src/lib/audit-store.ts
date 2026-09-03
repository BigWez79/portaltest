import "server-only";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FlagSnapshot } from "./staff-audit";

/**
 * Test-only audit trail. Stands in for `public.staff_audit` and its trigger so
 * the e2e suite can exercise the panel on the admin screen without a live
 * Supabase.
 *
 * Reachable only when STAFF_SOURCE=fixture, which playwright.config.ts sets and
 * nothing else does.
 *
 * One file per person, like the sign-in ledger and for the same reason: several
 * workers share this directory, and one file for the lot means a read, a write,
 * and somebody else's write lost in between. Two admins changing one person at
 * once is the only collision left, and the suite that does that runs serially.
 */
const DIR = path.join(process.cwd(), ".tmp", "staff-audit");

export type AuditRecord = {
  id: string;
  /** whose access changed */
  email: string;
  /** ISO 8601 */
  at: string;
  /** who changed it — resolved to a name when the trail is read, as in Postgres */
  byEmail: string | null;
  /** null for a row that was just added, as `before` is in the real table */
  before: FlagSnapshot | null;
  after: FlagSnapshot;
};

const fileFor = (email: string) =>
  path.join(DIR, `${Buffer.from(email.toLowerCase()).toString("base64url")}.json`);

async function read(email: string): Promise<AuditRecord[]> {
  try {
    return JSON.parse(await readFile(fileFor(email), "utf8")) as AuditRecord[];
  } catch {
    return [];
  }
}

let writeSeq = 0;

/** Write, then rename — a reader gets the whole old file or the whole new one. */
async function write(email: string, records: AuditRecord[]): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const target = fileFor(email);
  const pending = `${target}.${process.pid}.${++writeSeq}.tmp`;
  await writeFile(pending, JSON.stringify(records), "utf8");
  await rename(pending, target);
}

export const auditStore = {
  async record(entry: Omit<AuditRecord, "id" | "at">): Promise<void> {
    const existing = await read(entry.email);
    // Sequence in the id, not just the clock: two changes inside one
    // millisecond would otherwise sort arbitrarily and the panel would show
    // them in the wrong order.
    const id = `${Date.now()}-${String(existing.length + 1).padStart(4, "0")}`;
    await write(entry.email, [
      ...existing,
      { ...entry, id, at: new Date().toISOString() },
    ]);
  },

  async all(): Promise<AuditRecord[]> {
    let files: string[];
    try {
      files = await readdir(DIR);
    } catch {
      return [];
    }

    const records: AuditRecord[] = [];
    for (const name of files) {
      if (!name.endsWith(".json")) continue;
      try {
        records.push(
          ...(JSON.parse(await readFile(path.join(DIR, name), "utf8")) as AuditRecord[]),
        );
      } catch {
        // A half-written file is one a rename is about to replace. Skip it.
      }
    }
    return records;
  },

  /** Called by the test harness between runs, with the fixture staff list. */
  async reset(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(DIR);
    } catch {
      return;
    }
    await Promise.all(
      files
        .filter((name) => name.endsWith(".json"))
        .map((name) => writeFile(path.join(DIR, name), "[]", "utf8")),
    );
  },
};

import "server-only";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StaffRow } from "./staff";

/**
 * Test-only staff store. Lets the e2e suite exercise the admin screen's writes
 * without a live Supabase.
 *
 * Seeded from tests/fixtures/staff.json into .tmp/staff.json on first read, so a
 * test that flips a flag does not edit a tracked file and make the tree dirty.
 * Reachable only when STAFF_SOURCE=fixture.
 */
const SEED = path.join(process.cwd(), "tests", "fixtures", "staff.json");
const WORKING = path.join(process.cwd(), ".tmp", "staff.json");

async function load(): Promise<StaffRow[]> {
  try {
    // A working copy older than the seed is stale: the fixture set changed
    // under it. Reseed rather than testing yesterday's data.
    const [seedStat, workingStat] = await Promise.all([stat(SEED), stat(WORKING)]);
    if (seedStat.mtimeMs > workingStat.mtimeMs) throw new Error("seed is newer");

    return JSON.parse(await readFile(WORKING, "utf8")) as StaffRow[];
  } catch {
    const seed = JSON.parse(await readFile(SEED, "utf8")) as StaffRow[];
    await save(seed);
    return seed;
  }
}

/**
 * Write, then rename. Tests run in parallel workers against this one file, so a
 * plain writeFile leaves a window where a reader sees half a document — and
 * load()'s catch reads that as "no working copy" and reseeds, quietly throwing
 * away whatever the admin suite had just written. A rename is atomic: a reader
 * gets the whole old file or the whole new one.
 */
let writeSeq = 0;

async function save(rows: StaffRow[]): Promise<void> {
  await mkdir(path.dirname(WORKING), { recursive: true });
  // A counter, not a timestamp: two saves in the same millisecond would pick
  // the same name, and the second rename would find its file already moved.
  const pending = `${WORKING}.${process.pid}.${++writeSeq}.tmp`;
  await writeFile(pending, JSON.stringify(rows, null, 2), "utf8");
  await rename(pending, WORKING);
}

export const fixtureStore = {
  async all(): Promise<StaffRow[]> {
    return load();
  },

  async find(keys: string[]): Promise<StaffRow | null> {
    const rows = await load();
    return rows.find((r) => keys.includes(r.email.toLowerCase())) ?? null;
  },

  async update(email: string, patch: Partial<StaffRow>): Promise<StaffRow | null> {
    const rows = await load();
    const index = rows.findIndex((r) => r.email.toLowerCase() === email.toLowerCase());
    if (index === -1) return null;
    rows[index] = { ...rows[index], ...patch };
    await save(rows);
    return rows[index];
  },

  async insert(row: StaffRow): Promise<StaffRow> {
    const rows = await load();
    if (rows.some((r) => r.email.toLowerCase() === row.email.toLowerCase())) {
      throw new Error(`${row.email} is already on the staff list`);
    }
    rows.push(row);
    await save(rows);
    return row;
  },

  /** Called by the test harness between runs. */
  async reset(): Promise<void> {
    const seed = JSON.parse(await readFile(SEED, "utf8")) as StaffRow[];
    await save(seed);
  },
};

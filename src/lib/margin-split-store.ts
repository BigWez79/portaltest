import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { FULL_SHARE, type Contractor, type Drawing, type Job } from "./margin-split-calc";

/**
 * Test-only Margin Split store, the same shape as expenses-store.ts: seeded
 * from tests/fixtures into .tmp, saved by rename. Reachable only when
 * STAFF_SOURCE=fixture.
 *
 * It refuses shares that do not total 10000 itself, as the table's trigger
 * does, so the suite cannot pass against a store laxer than the database.
 */

type Doc = { jobs: Job[]; contractors: Contractor[]; drawings: Drawing[] };

const SEED = path.join(process.cwd(), "tests", "fixtures", "margin-split.json");
const WORKING = path.join(process.cwd(), ".tmp", "margin-split.json");

async function seed(): Promise<Doc> {
  return JSON.parse(await readFile(SEED, "utf8")) as Doc;
}

async function load(): Promise<Doc> {
  try {
    const [seedStat, workingStat] = await Promise.all([stat(SEED), stat(WORKING)]);
    if (seedStat.mtimeMs > workingStat.mtimeMs) throw new Error("seed is newer");
    return JSON.parse(await readFile(WORKING, "utf8")) as Doc;
  } catch {
    const doc = await seed();
    await save(doc);
    return doc;
  }
}

async function save(doc: Doc): Promise<void> {
  await mkdir(path.dirname(WORKING), { recursive: true });
  const pending = `${WORKING}.${randomUUID()}.tmp`;
  await writeFile(pending, JSON.stringify(doc, null, 2), "utf8");
  await rename(pending, WORKING);
}

export const marginSplitStore = {
  async read(): Promise<Doc> {
    return load();
  },

  async addJob(job: Omit<Job, "id">): Promise<boolean> {
    const doc = await load();
    doc.jobs.push({ id: randomUUID(), ...job });
    await save(doc);
    return true;
  },

  async addContractor(name: string): Promise<boolean> {
    const doc = await load();
    const position = Math.max(0, ...doc.contractors.map((c) => c.position)) + 1;
    doc.contractors.push({ id: randomUUID(), name, shareBp: 0, position });
    await save(doc);
    return true;
  },

  async setShares(rows: { id: string; name: string; shareBp: number }[]): Promise<boolean> {
    const doc = await load();
    const next = doc.contractors.map((c) => {
      const row = rows.find((r) => r.id === c.id);
      return row ? { ...c, name: row.name, shareBp: row.shareBp } : c;
    });
    if (next.reduce((s, c) => s + c.shareBp, 0) !== FULL_SHARE) return false;
    doc.contractors = next;
    await save(doc);
    return true;
  },

  async addDrawing(drawing: Omit<Drawing, "id">): Promise<boolean> {
    const doc = await load();
    if (!doc.contractors.some((c) => c.id === drawing.contractorId)) return false;
    doc.drawings.push({ id: randomUUID(), ...drawing });
    await save(doc);
    return true;
  },

  async reset(): Promise<void> {
    await save(await seed());
  },
};

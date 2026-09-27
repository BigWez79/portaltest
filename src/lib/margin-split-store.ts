import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { WHOLE_BP, type MsData, type MsDrawing, type MsJob } from "./margin-split-calc";
import type { ContractorInput, MsResult } from "./margin-split";

/**
 * Test-only Margin Split store. Same shape as the other fixture stores: seeded
 * from tests/fixtures into .tmp, saved by rename, named with a random suffix.
 * Reachable only when STAFF_SOURCE=fixture.
 *
 * The seed is written in the application's spelling, so there is no mapping
 * between seed and working copy to get wrong.
 *
 * It refuses shares that do not total 10000 and a drawing against a contractor
 * who is not there. Both duplicate 0012_margin_split.sql, deliberately: a
 * store that accepted them would let the suite pass against rules the real
 * tables enforce.
 */

const SEED = path.join(process.cwd(), "tests", "fixtures", "margin-split.json");
const WORKING = path.join(process.cwd(), ".tmp", "margin-split.json");

function normalise(raw: unknown): MsData {
  const d = (raw ?? {}) as Partial<MsData>;
  return { jobs: d.jobs ?? [], contractors: d.contractors ?? [], drawings: d.drawings ?? [] };
}

async function load(): Promise<MsData> {
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

async function save(doc: MsData): Promise<void> {
  await mkdir(path.dirname(WORKING), { recursive: true });
  const pending = `${WORKING}.${randomUUID()}.tmp`;
  await writeFile(pending, JSON.stringify(doc, null, 2), "utf8");
  await rename(pending, WORKING);
}

export const marginSplitStore = {
  async data(): Promise<MsData> {
    return load();
  },

  async addJob(input: Omit<MsJob, "id">): Promise<MsResult> {
    const doc = await load();
    doc.jobs.push({ id: randomUUID(), ...input });
    await save(doc);
    return { ok: true };
  },

  async removeJob(id: string): Promise<MsResult> {
    const doc = await load();
    const left = doc.jobs.filter((j) => j.id !== id);
    if (left.length === doc.jobs.length) return { ok: false, message: "That job is no longer there." };
    doc.jobs = left;
    await save(doc);
    return { ok: true };
  },

  async saveContractors(list: ContractorInput[]): Promise<MsResult> {
    const doc = await load();
    const total = list.reduce((s, c) => s + c.shareBp, 0);
    if (total !== WHOLE_BP) return { ok: false, message: "Shares must total exactly 100%." };

    // Every existing contractor must still be in the list: drawings point at
    // them, and this screen has no way to remove one.
    const kept = new Set(list.filter((c) => c.id).map((c) => c.id));
    if (doc.contractors.some((c) => !kept.has(c.id))) {
      return { ok: false, message: "A contractor is missing from the list. Reload and try again." };
    }

    doc.contractors = list.map((c, i) => ({
      id: c.id ?? randomUUID(),
      name: c.name,
      shareBp: c.shareBp,
      position: i + 1,
    }));
    await save(doc);
    return { ok: true };
  },

  async addDrawing(input: Omit<MsDrawing, "id">): Promise<MsResult> {
    const doc = await load();
    if (!doc.contractors.some((c) => c.id === input.contractorId)) {
      return { ok: false, message: "Choose a contractor." };
    }
    doc.drawings.push({ id: randomUUID(), ...input });
    await save(doc);
    return { ok: true };
  },

  async removeDrawing(id: string): Promise<MsResult> {
    const doc = await load();
    const left = doc.drawings.filter((d) => d.id !== id);
    if (left.length === doc.drawings.length) {
      return { ok: false, message: "That drawing is no longer there." };
    }
    doc.drawings = left;
    await save(doc);
    return { ok: true };
  },

  /** Back to the seed. The suite calls this between write tests. */
  async reset(): Promise<void> {
    await save(normalise(JSON.parse(await readFile(SEED, "utf8"))));
  },
};

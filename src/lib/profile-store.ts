import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMPTY_PROFILE, toProfile, type Profile, type ProfileInput } from "./profile-calc";

/**
 * Test-only profile store. Same shape as the other fixture stores: seeded from
 * tests/fixtures into .tmp, saved by rename, named with a random suffix.
 * Reachable only when STAFF_SOURCE=fixture.
 */

const SEED = path.join(process.cwd(), "tests", "fixtures", "profiles.json");
const WORKING = path.join(process.cwd(), ".tmp", "profiles.json");

function normalise(raw: unknown): Profile[] {
  return (((raw ?? {}) as Record<string, unknown>).profiles as unknown[] ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    // The seed is in the database's spelling, the working copy in the
    // application's. Mapping a working copy twice yields a row owned by nobody.
    return "staffEmail" in row ? (row as unknown as Profile) : toProfile(row);
  });
}

async function load(): Promise<Profile[]> {
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

async function save(rows: Profile[]): Promise<void> {
  await mkdir(path.dirname(WORKING), { recursive: true });
  const pending = `${WORKING}.${randomUUID()}.tmp`;
  await writeFile(pending, JSON.stringify({ profiles: rows }, null, 2), "utf8");
  await rename(pending, WORKING);
}

export const profileStore = {
  async get(email: string): Promise<Profile> {
    const rows = await load();
    return rows.find((p) => p.staffEmail === email) ?? { ...EMPTY_PROFILE, staffEmail: email };
  },

  async save(email: string, input: ProfileInput): Promise<boolean> {
    const rows = await load();
    const at = rows.findIndex((p) => p.staffEmail === email);
    const row: Profile = { ...input, staffEmail: email };
    if (at === -1) rows.push(row);
    else rows[at] = row;
    await save(rows);
    return true;
  },

  async reset(): Promise<void> {
    await save(normalise(JSON.parse(await readFile(SEED, "utf8"))));
  },
};

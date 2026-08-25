import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * Wipes the fixture working store before every run.
 *
 * `src/lib/fixture-store.ts` seeds `.tmp/staff.json` from
 * `tests/fixtures/staff.json` on first read, then works from the copy so that
 * tests which write do not dirty a tracked file. Without this, a `.tmp` left
 * over from an earlier run silently outlives a change to the seed — the suite
 * then tests yesterday's fixture data and reports green on code it never
 * exercised.
 *
 * That is exactly how the seven-tile change passed locally and failed on
 * another machine.
 */
export default async function globalSetup() {
  await rm(path.join(process.cwd(), ".tmp"), { recursive: true, force: true });
}

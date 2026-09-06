import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Test-only session ledger. Stands in for `auth.sessions` and
 * `public.revoke_staff_sessions` so the e2e suite can exercise being signed out
 * mid-session without a live Supabase.
 *
 * Reachable only when E2E_TEST_MODE=1, which playwright.config.ts sets and
 * nothing else does.
 *
 * A generation per address, not a timestamp. /api/test/session stamps the
 * current generation into the cookie it plants; getCurrentUser() treats a
 * cookie whose generation has moved on as no session at all. That models what
 * Supabase does — a token issued before the revocation is dead, one issued
 * after it is fine — with no clock in it, so two events in the same millisecond
 * cannot decide it the wrong way round.
 *
 * One file per address, like the sign-in ledger and the audit trail: several
 * workers share this directory and one file for the lot loses writes.
 *
 * There is deliberately no reset. A generation only ever goes up, so a stale
 * cookie stays stale for the whole run; setting them back to zero would revive
 * a session another worker had already been signed out of.
 * tests/global-setup.ts deletes .tmp before every run, which is the reset.
 */
const DIR = path.join(process.cwd(), ".tmp", "sessions");

const fileFor = (email: string) =>
  path.join(DIR, `${Buffer.from(email.toLowerCase()).toString("base64url")}.json`);

let writeSeq = 0;

/** Write, then rename — a reader gets the whole old file or the whole new one. */
async function write(email: string, generation: number): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const target = fileFor(email);
  const pending = `${target}.${process.pid}.${++writeSeq}.tmp`;
  await writeFile(pending, JSON.stringify({ generation }), "utf8");
  await rename(pending, target);
}

export const sessionStore = {
  /** Which generation of this person's sessions is current. Nobody revoked: 0. */
  async generation(email: string): Promise<number> {
    try {
      const parsed = JSON.parse(await readFile(fileFor(email), "utf8")) as {
        generation?: number;
      };
      return typeof parsed.generation === "number" ? parsed.generation : 0;
    } catch {
      return 0;
    }
  },

  /** Ends every session this person holds. Returns the new generation. */
  async revoke(email: string): Promise<number> {
    const next = (await sessionStore.generation(email)) + 1;
    await write(email, next);
    return next;
  },
};

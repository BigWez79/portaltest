import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SIGNIN_LIMITS } from "./rate-limit";

/**
 * Test-only sign-in ledger. Stands in for `public.signin_attempts` and
 * `consume_signin_attempt` so the e2e suite can exercise the limit without a
 * live Supabase, and enforces the same numbers from `SIGNIN_LIMITS`.
 *
 * Reachable only when STAFF_SOURCE=fixture, which playwright.config.ts sets and
 * nothing else does.
 *
 * One file per key rather than one file for the store: the suite runs several
 * workers against the same directory, and a shared file means a spec that asks
 * for a link can drop the rows another spec is counting on — a read, then a
 * write, with somebody else's write in between. Different addresses and
 * different IPs land in different files, so only a test racing itself can
 * collide, and those run serially.
 */
const DIR = path.join(process.cwd(), ".tmp", "signin-attempts");

type Attempt = { at: number; allowed: boolean };

const fileFor = (key: string) =>
  path.join(DIR, `${Buffer.from(key).toString("base64url")}.json`);

async function read(key: string): Promise<Attempt[]> {
  try {
    return JSON.parse(await readFile(fileFor(key), "utf8")) as Attempt[];
  } catch {
    return [];
  }
}

let writeSeq = 0;

/** Write, then rename — a reader gets the whole old file or the whole new one. */
async function write(key: string, attempts: Attempt[]): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const target = fileFor(key);
  const pending = `${target}.${process.pid}.${++writeSeq}.tmp`;
  await writeFile(pending, JSON.stringify(attempts), "utf8");
  await rename(pending, target);
}

const within = (attempts: Attempt[], windowMs: number, now: number) =>
  attempts.filter((a) => a.at > now - windowMs);

export const signInAttemptStore = {
  /**
   * Records a request and answers whether a link should go out. A refused
   * attempt is stored but does not count towards either window, so a burst
   * costs the person one window rather than compounding.
   */
  async consume(email: string, ip: string | null): Promise<boolean> {
    const now = Date.now();
    const emailKey = `email:${email}`;
    const ipKey = ip ? `ip:${ip}` : null;

    const emailAttempts = within(await read(emailKey), SIGNIN_LIMITS.perEmail.windowMs, now);
    const ipAttempts = ipKey
      ? within(await read(ipKey), SIGNIN_LIMITS.perIp.windowMs, now)
      : [];

    const sent = (attempts: Attempt[]) => attempts.filter((a) => a.allowed).length;

    const allowed =
      sent(emailAttempts) < SIGNIN_LIMITS.perEmail.limit &&
      (ipKey === null || sent(ipAttempts) < SIGNIN_LIMITS.perIp.limit);

    await write(emailKey, [...emailAttempts, { at: now, allowed }]);
    if (ipKey) await write(ipKey, [...ipAttempts, { at: now, allowed }]);

    return allowed;
  },

  /**
   * What the ledger holds for one key — the only way a test can tell a link
   * that went out from one that was refused, because the person is told the
   * same thing either way.
   */
  async summary(key: string): Promise<{ allowed: number; refused: number }> {
    const attempts = await read(key);
    return {
      allowed: attempts.filter((a) => a.allowed).length,
      refused: attempts.filter((a) => !a.allowed).length,
    };
  },
};

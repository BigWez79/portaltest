import { test as base, expect, type Page } from "@playwright/test";

/**
 * A crash counts as a failure. Any console error, uncaught exception or 5xx
 * fails the test that caused it, whatever the assertions said.
 */
export const test = base.extend<{ page: Page; tolerate: string[] }>({
  /**
   * Console noise a test expects. A test that deliberately requests a 404 gets
   * one from the browser itself; everything else still fails the run.
   * Use with test.use({ tolerate: ["status of 404"] }).
   */
  tolerate: [[], { option: true }],

  page: async ({ page, tolerate }, use) => {
    const problems: string[] = [];
    const expected = (text: string) => tolerate.some((t) => text.includes(t));

    page.on("console", (msg) => {
      if (msg.type() === "error" && !expected(msg.text())) {
        problems.push(`console.error: ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      problems.push(`pageerror: ${err.message}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 500) problems.push(`${res.status()} from ${res.url()}`);
    });

    await use(page);

    expect(problems, `page reported ${problems.length} problem(s)`).toEqual([]);
  },
});

export { expect };

/**
 * The seeder calls go through a retry, because a dropped connection to the test
 * server is not a fact about the code.
 *
 * The 03:00 run on 2026-08-28 failed the whole suite on this:
 *
 *   Error: apiRequestContext.post: read ECONNRESET
 *     → POST http://127.0.0.1:3100/api/test/session?reset=1
 *     at resetStaff (tests/harness.ts:58)
 *
 * One reset, on one of 116 tests, on a machine that had just finished an npm ci.
 * Nothing was wrong with the app and nothing was wrong with the test; the socket
 * went away. Left alone that turns a green suite into a red one at random, and
 * an overnight run into a draft pull request nobody asked for.
 *
 * Deliberately narrow: three attempts, only around the test-mode seeder, and
 * only for transport failures — a seeder that answers with an error status still
 * fails immediately, because that IS a fact about the code.
 */
const TRANSPORT_ERROR = /ECONNRESET|ECONNREFUSED|socket hang up|EPIPE|network|Timeout/i;

async function seederRequest(
  attempt: () => Promise<{ ok: () => boolean; status: () => number }>,
  what: string,
) {
  let lastError: unknown;
  for (let tries = 0; tries < 3; tries++) {
    try {
      const res = await attempt();
      expect(res.ok(), `${what} should answer (got ${res.status()})`).toBeTruthy();
      return res;
    } catch (error) {
      // An assertion failure is a real result — do not paper over it by retrying.
      if (!(error instanceof Error) || !TRANSPORT_ERROR.test(error.message)) throw error;
      lastError = error;
      await new Promise((r) => setTimeout(r, 250 * (tries + 1)));
    }
  }
  throw lastError;
}

/** Plants a session without sending an email or reaching Supabase. Test mode only. */
export async function signInAs(
  page: Page,
  email: string,
  opts: { name?: string } = {},
) {
  const params = new URLSearchParams({ email });
  if (opts.name) params.set("name", opts.name);

  await seederRequest(
    () => page.request.get(`/api/test/session?${params.toString()}`),
    "the test session seeder",
  );
}

export async function signOutCompletely(page: Page) {
  await page.request.delete("/api/test/session");
}

/** Restores the fixture staff list. Only for tests that write. */
export async function resetStaff(page: Page) {
  await seederRequest(
    () => page.request.post("/api/test/session?reset=1"),
    "the fixture store reset",
  );
}

export const ALL_TILES = [
  "invoices",
  "timesheet",
  "expenses",
  "margin",
  "taxBreakdown",
  "profile",
  "admin",
] as const;

/**
 * Asserts the exact set of tiles — and that the others are absent from the DOM,
 * not merely hidden. Portal v2.0 shipped every tile to every browser and hid
 * them with CSS; this is the assertion that stops that returning.
 */
export async function expectExactlyTiles(page: Page, expected: readonly string[]) {
  for (const id of ALL_TILES) {
    const locator = page.getByTestId(`tile-${id}`);
    if (expected.includes(id)) {
      await expect(locator, `${id} tile should be shown`).toBeVisible();
    } else {
      await expect(locator, `${id} tile should not be in the DOM at all`).toHaveCount(0);
    }
  }
}

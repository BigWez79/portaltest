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
 * One retry on a dropped connection.
 *
 * `next start` closes idle keep-alive sockets, and a request that goes out as
 * one is closing comes back ECONNRESET — the server never saw it, so nothing
 * about the app is being excused here. A 5xx still comes back as a response and
 * still fails the caller's `res.ok()`, and a second reset is not swallowed.
 */
async function onceMore<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/ECONNRESET|socket hang up/.test(message)) throw err;
    return await run();
  }
}

/** Plants a session without sending an email or reaching Supabase. Test mode only. */
export async function signInAs(
  page: Page,
  email: string,
  opts: { name?: string } = {},
) {
  const params = new URLSearchParams({ email });
  if (opts.name) params.set("name", opts.name);

  const res = await onceMore(() =>
    page.request.get(`/api/test/session?${params.toString()}`),
  );
  expect(res.ok(), "the test session seeder should be available").toBeTruthy();
}

export async function signOutCompletely(page: Page) {
  await onceMore(() => page.request.delete("/api/test/session"));
}

/**
 * Fills in the sign-in form and returns what the person is told.
 *
 * Deliberately returns the message rather than asserting on it: whether a link
 * went out or was refused, this is the same string, and a test that could tell
 * them apart from here would be a test of a leak.
 */
export async function askForLink(page: Page, email: string): Promise<string> {
  await page.goto("/");
  await page.getByTestId("email").fill(email);
  await page.getByTestId("signin").click();
  const sent = page.getByTestId("link-sent");
  await expect(sent).toBeVisible();
  return ((await sent.textContent()) ?? "").trim();
}

/**
 * What the sign-in ledger recorded for one address or one IP — the only way to
 * tell a link that went out from one that was refused. Test mode only.
 */
export async function linkLedger(
  page: Page,
  key: { email?: string; ip?: string },
): Promise<{ allowed: number; refused: number }> {
  const params = new URLSearchParams(
    key.email ? { email: key.email } : { ip: key.ip ?? "" },
  );
  const res = await onceMore(() =>
    page.request.get(`/api/test/rate-limit?${params.toString()}`),
  );
  expect(res.ok(), "the sign-in ledger should be readable").toBeTruthy();
  const body = (await res.json()) as { allowed: number; refused: number };
  return { allowed: body.allowed, refused: body.refused };
}

/** Restores the fixture staff list. Only for tests that write. */
export async function resetStaff(page: Page) {
  const res = await onceMore(() => page.request.post("/api/test/session?reset=1"));
  expect(res.ok(), "the fixture store should be resettable").toBeTruthy();
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

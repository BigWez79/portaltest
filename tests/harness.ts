import { test as base, expect, type Page } from "@playwright/test";

/**
 * A crash counts as a failure. Any console error or uncaught page exception
 * fails the test that caused it, whatever the assertions said.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const problems: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
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

/** Plants a session without touching Entra. Test mode only. */
export async function signInAs(
  page: Page,
  email: string,
  opts: { upn?: string; name?: string } = {},
) {
  const params = new URLSearchParams({ email });
  if (opts.upn) params.set("upn", opts.upn);
  if (opts.name) params.set("name", opts.name);

  const res = await page.request.get(`/api/test/session?${params.toString()}`);
  expect(res.ok(), "the test session seeder should be available").toBeTruthy();
}

export async function signOutCompletely(page: Page) {
  await page.request.delete("/api/test/session");
}

export const ALL_TILES = ["invoices", "timesheet", "expenses", "admin"] as const;

/**
 * Asserts the exact set of tiles on the page — and that the others are absent
 * from the DOM, not merely hidden. Portal v2.0 shipped every tile to every
 * browser and hid them with CSS; this is the assertion that stops that
 * returning.
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

import { expect, signInAs, test } from "./harness";

/**
 * The two dead ends: a page that is not there, and a page that broke.
 *
 * The 404 matters more here than it would elsewhere. Rule 4 says a route
 * answers 404 for anybody without its flag, and the whole point of 404 over 403
 * is that it withholds the fact that the route exists. Handing that person
 * Next's own page gives half of it straight back — they have plainly reached
 * something real, and they can see what it is built with.
 *
 * What these check is what the page SAYS. The served HTML is a different
 * question and not one a copy change can fix: the flight payload for a
 * notFound() thrown out of requireApp carries the segment name, and every
 * response links /_next/static/… whatever the page says. So the assertions read
 * the rendered text, which is the part that is ours to get right, and the
 * status code is asserted separately — a styled 404 that answered 200 would be
 * the real regression.
 */

/** Nothing on either page may say any of this. */
const MUST_NOT_SAY = [
  // the route, and the flag behind it
  "invoices",
  "has_invoices",
  "flag",
  "access",
  "permission",
  "not found",
  "could not be found",
  // the status, and the one it is deliberately not
  "404",
  "403",
  "500",
  // what it is built with
  "next",
  "react",
  "turbopack",
  "webpack",
  "vercel",
  // what broke
  "error",
  "stack",
  "digest",
  "crash",
  "deliberate",
];

async function saysNothing(text: string) {
  const said = text.toLowerCase();
  for (const word of MUST_NOT_SAY) {
    expect(said, `a dead end must not say "${word}"`).not.toContain(word);
  }
}

test.describe("the 404", () => {
  test.use({ tolerate: ["status of 404"] });

  test("a route the person has no flag for gets Power Suite's own page", async ({
    page,
  }) => {
    // Active staff, no flag for this app — the case rule 4 is about.
    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/invoices");

    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();
  });

  test("an address that was never a route gets the same page", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    const res = await page.goto("/nothing-here-at-all");

    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();
  });

  test("it names no route, no flag and no framework", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/invoices");
    await expect(page.getByTestId("not-found")).toBeVisible();

    await saysNothing((await page.locator("body").innerText()) ?? "");
  });

  test("the only way off it is the front door", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/invoices");
    await expect(page.getByTestId("not-found")).toBeVisible();

    // A list of somewhere-else-to-try would undo the whole thing.
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(["/"]);
  });

  for (const w of [
    { name: "390-phone", width: 390, height: 844 },
    { name: "1440-desktop", width: 1440, height: 900 },
  ]) {
    test(`renders at ${w.name}`, async ({ page }, testInfo) => {
      await signInAs(page, "no.flags@example.test");
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/invoices");
      await expect(page.getByTestId("not-found")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll horizontally").toBeLessThanOrEqual(0);

      await testInfo.attach(`not-found-${w.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
});

test.describe("a page that breaks", () => {
  /**
   * Declared, not switched off. A page that throws on purpose answers 500, the
   * browser says so twice, React says the render failed, and error.tsx adds the
   * digest line itself. Those four and nothing else — any other console error,
   * any other 5xx, still fails the run.
   */
  test.use({
    tolerate: [
      "/api/test/crash",
      "status of 500",
      "React error #441",
      "[error] a page failed to render",
    ],
  });

  test("gets Power Suite's own page, and says nothing about what broke", async ({
    page,
  }, testInfo) => {
    const logged: string[] = [];
    page.on("console", (msg) => logged.push(msg.text()));

    await signInAs(page, "everything@example.test");
    const res = await page.goto("/api/test/crash");

    expect(res?.status()).toBe(500);
    await expect(page.getByTestId("crashed")).toBeVisible();

    // The digest is the only thread between what the person saw and the server
    // log, so it has to actually be written down somewhere.
    expect(
      logged.filter((line) => /\[error\] a page failed to render — digest \S+/.test(line)),
      "error.tsx should log the digest",
    ).toHaveLength(1);

    await saysNothing((await page.locator("body").innerText()) ?? "");

    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(["/"]);

    await testInfo.attach("crashed-1440-desktop.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
});

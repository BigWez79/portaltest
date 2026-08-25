import { expect, signInAs, signOutCompletely, test } from "./harness";

/**
 * Phone-first means desktop-never unless you say so. These are named widths,
 * and each one leaves a screenshot behind for the pull request.
 */
const WIDTHS = [
  { name: "390-phone", width: 390, height: 844, columns: 1 },
  { name: "768-tablet", width: 768, height: 1024, columns: 2 },
  { name: "1024-laptop", width: 1024, height: 768, columns: 2 },
  { name: "1440-desktop", width: 1440, height: 900, columns: 2 },
];

test.describe("layout at every width", () => {
  for (const w of WIDTHS) {
    test(`signed in at ${w.name}`, async ({ page }, testInfo) => {
      await signInAs(page, "everything@example.test");
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");
      await expect(page.getByTestId("tiles")).toBeVisible();

      const columns = await page
        .getByTestId("tiles")
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(columns, `${w.name} should lay the tiles out in ${w.columns} column(s)`).toBe(
        w.columns,
      );

      // Nothing should push the page sideways.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll horizontally").toBeLessThanOrEqual(0);

      await testInfo.attach(`portal-${w.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });

    test(`signed out at ${w.name}`, async ({ page }, testInfo) => {
      await signOutCompletely(page);
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");
      await expect(page.getByTestId("login-view")).toBeVisible();

      await testInfo.attach(`signin-${w.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
});

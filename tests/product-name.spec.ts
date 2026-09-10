import { expect, signInAs, signOutCompletely, test } from "./harness";

/**
 * The product is Power Suite; the company is still Power Analytix.
 *
 * A rename is the sort of thing that half-lands and then drifts, so the two
 * places a person actually reads the product's name are pinned: the browser
 * tab, and the line above the heading on every screen. Both are checked at the
 * narrowest and the widest supported width, because the sign-in card, the tiles
 * and the app shell each carry their own copy of it and a phone shows a
 * different one of them first.
 *
 * What would make this pass while the rename is broken: nothing that leaves the
 * name wrong in the tab or the heading. Rename either back and one of these
 * fails — the assertions read the rendered text, not a constant.
 */
const WIDTHS = [
  { name: "390-phone", width: 390, height: 844 },
  { name: "1440-desktop", width: 1440, height: 900 },
];

test.describe("the product name", () => {
  for (const w of WIDTHS) {
    test(`signed out, the tab and the card read Power Suite at ${w.name}`, async ({
      page,
    }) => {
      await signOutCompletely(page);
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");

      await expect(page).toHaveTitle(/Power Suite/);
      await expect(page.getByTestId("product-name")).toHaveText("Power Suite");
    });

    test(`signed in, the tab and every heading read Power Suite at ${w.name}`, async ({
      page,
    }) => {
      await signInAs(page, "everything@example.test");
      await page.setViewportSize({ width: w.width, height: w.height });

      await page.goto("/");
      await expect(page).toHaveTitle(/Power Suite/);
      await expect(page.getByTestId("product-name")).toHaveText("Power Suite");

      // The shell every app route sits in carries it as well: the heading is
      // that app's name, the line above it is the product's.
      await page.goto("/admin");
      await expect(page.getByTestId("product-name")).toHaveText("Power Suite");
    });
  }
});

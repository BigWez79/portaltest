import { expect, resetStores, signInAs, test } from "./harness";

/**
 * Expenses — the first ported app that writes.
 *
 * The calculators could be tested by reading a page. This one has to be tested
 * by changing something and looking again, which is why it runs serially after
 * a reset: parallel workers share one fixture file, and a suite that leaves
 * rows behind poisons the next one.
 */

const OWNER = "expenses.only@example.test";
const OTHER = "everything@example.test";

test.describe("expenses — reading your own", () => {
  test("the claims you already have are listed, newest month first", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await expect(page.getByTestId("expenses-app")).toBeVisible();
    await expect(page.getByTestId("month-2026-07")).toBeVisible();
    await expect(page.getByTestId("month-2026-06")).toBeVisible();

    // £66.28 mileage + £89.00 hotel
    await expect(page.getByTestId("total-2026-07")).toHaveText("£155.28");
  });

  test("somebody else's claims are not in the page", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    // everything@ has a £47.80 train fare in the same month. It is not this
    // person's, so it must not be in the total or the DOM.
    await expect(page.getByTestId("total-2026-07")).not.toHaveText("£203.08");
    await expect(page.getByText("Return to London")).toHaveCount(0);
  });

  test("a locked month says so and offers nothing to change", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await expect(page.getByTestId("locked-2026-06")).toBeVisible();
    await expect(page.getByTestId("submit-2026-06")).toHaveCount(0);
    await expect(page.getByTestId("remove-33333333-3333-4333-8333-333333333333")).toHaveCount(0);
  });

  test("the mileage rates panel is an admin's, not everybody's", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");
    await expect(page.getByTestId("rates-card")).toHaveCount(0);

    await signInAs(page, OTHER); // everything@ is an admin
    await page.goto("/expenses");
    await expect(page.getByTestId("rates-card")).toBeVisible();
  });
});

test.describe.serial("expenses — writing", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "expenses");
  });

  test("an expense can be added and appears in its month", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await page.getByTestId("expense-date").fill("2026-08-11");
    await page.getByTestId("expense-type").selectOption("Parking");
    await page.getByTestId("expense-amount").fill("7.40");
    await page.getByTestId("expense-reason").fill("Station car park");
    await page.getByTestId("expense-submit").click();

    await expect(page.getByTestId("expense-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("total-2026-08")).toHaveText("£7.40");
  });

  test("mileage is priced by the server, tiered against the tax year", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await page.getByTestId("expense-date").fill("2026-08-12");
    await page.getByTestId("expense-type").selectOption("Mileage");
    await page.getByTestId("expense-miles").fill("100");
    await page.getByTestId("expense-submit").click();

    await expect(page.getByTestId("expense-ok")).toBeVisible({ timeout: 15000 });
    // 100 miles at 0.55, well inside the 10,000 threshold.
    await expect(page.getByTestId("total-2026-08")).toHaveText("£55.00");
  });

  test("the preview says what a journey is worth before it is saved", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await page.getByTestId("expense-type").selectOption("Mileage");
    await page.getByTestId("expense-miles").fill("40");

    await expect(page.getByTestId("mileage-preview")).toContainText("£22.00");
  });

  test("an expense can be removed", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await page.getByTestId("remove-22222222-2222-4222-8222-222222222222").click();

    await expect(page.getByTestId("row-22222222-2222-4222-8222-222222222222")).toHaveCount(0);
    // £155.28 less the £89.00 hotel
    await expect(page.getByTestId("total-2026-07")).toHaveText("£66.28");
  });

  test("submitting a month locks it, and the lock holds on reload", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await page.getByTestId("submit-2026-07").click();
    await expect(page.getByTestId("lock-ok")).toBeVisible({ timeout: 15000 });

    await page.reload();
    await expect(page.getByTestId("locked-2026-07")).toBeVisible();
    await expect(page.getByTestId("submit-2026-07")).toHaveCount(0);
  });

  test("an admin can change the mileage rates, and the next claim uses them", async ({ page }) => {
    await signInAs(page, OTHER);
    await page.goto("/expenses");

    await page.getByTestId("rate1").fill("0.80");
    await page.getByTestId("save-rates").click();
    await expect(page.getByTestId("rates-ok")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("expense-type").selectOption("Mileage");
    await page.getByTestId("expense-miles").fill("10");
    await expect(page.getByTestId("mileage-preview")).toContainText("£8.00");
  });
});

test.describe("expenses — the guard", () => {
  test.use({ tolerate: ["status of 404"] });

  test("somebody without the flag gets a 404, not a 403", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/expenses");
    expect(res?.status()).toBe(404);
  });
});

test.describe("expenses — layout", () => {
  for (const width of [390, 1440]) {
    test(`the claim table fits at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(page, OWNER);
      await page.goto("/expenses");

      await expect(page.getByTestId("expenses-app")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
    });
  }
});

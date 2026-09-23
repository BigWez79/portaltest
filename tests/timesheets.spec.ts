import { expect, resetStores, signInAs, test } from "./harness";

/**
 * Timesheets — the largest file on the live suite and the one people open
 * daily.
 *
 * The write tests run serially after a reset: parallel workers share one
 * fixture file, and a suite that leaves hours behind poisons the next one.
 */

const STAFF = "timesheet.only@example.test";
const OTHER = "everything@example.test";

test.describe("timesheets — reading your own", () => {
  test("a day holds several activities and totals them", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await expect(page.getByTestId("timesheets-app")).toBeVisible();
    // 6.5 hours of project work plus a 1.5 hour meeting.
    await expect(page.getByTestId("day-total-2026-07-15")).toHaveText("8 h");
  });

  test("the month counts leave, and the worked figure does not", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    // July: 6.5 + 1.5 worked, plus 8 hours of annual leave.
    await expect(page.getByTestId("total-2026-07")).toHaveText("16 h");
    await expect(page.getByTestId("kpi-hours")).toContainText("16 h");
    await expect(page.getByTestId("kpi-worked")).toContainText("8 h");
  });

  test("somebody else's hours are not in the page", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await expect(page.getByText("Somebody else's afternoon")).toHaveCount(0);
    // Their 3 hours on the same day would make it 11.
    await expect(page.getByTestId("day-total-2026-07-15")).not.toHaveText("11 h");
  });

  test("a closed month says so and offers nothing to change", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await expect(page.getByTestId("closed-2026-06")).toBeVisible();
    await expect(page.getByTestId("close-2026-06")).toHaveCount(0);
    await expect(page.getByTestId("remove-70000004-0000-4000-8000-000000000004")).toHaveCount(0);
  });
});

test.describe.serial("timesheets — writing", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "timesheets");
  });

  test("hours can be logged and appear on their day", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-date").fill("2026-08-05");
    await page.getByTestId("entry-type").selectOption("Development");
    await page.getByTestId("entry-hours").fill("3.25");
    await page.getByTestId("entry-desc").fill("Build pipeline");
    await page.getByTestId("log-submit").click();

    await expect(page.getByTestId("log-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("day-total-2026-08-05")).toHaveText("3.25 h");
  });

  test("leave is a whole day, and the hours box goes away", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-type").selectOption("Annual Leave");
    await expect(page.getByTestId("entry-fixed")).toBeVisible();
    await expect(page.getByTestId("entry-hours")).toHaveCount(0);

    await page.getByTestId("entry-date").fill("2026-08-06");
    await page.getByTestId("log-submit").click();

    await expect(page.getByTestId("log-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("day-total-2026-08-06")).toHaveText("8 h");
  });

  test("a day with more hours than a day has is refused", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-date").fill("2026-08-07");
    await page.getByTestId("entry-type").selectOption("Project work");

    // The input carries max="24", so the browser refuses to submit and the
    // server check is never reached. That attribute is a convenience, not the
    // check — drop it and post anyway, which is what anything other than this
    // form would do. The live page has no limit at either end, so a slipped
    // decimal point logs 800 hours and the month's total is quietly nonsense.
    await page.getByTestId("entry-hours").evaluate((el) => el.removeAttribute("max"));
    await page.getByTestId("entry-hours").fill("80");
    await page.getByTestId("log-submit").click();

    await expect(page.getByTestId("log-error")).toContainText("24 hours", { timeout: 15000 });
  });

  test("an entry can be removed and the day comes down", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("remove-70000002-0000-4000-8000-000000000002").click();

    await expect(page.getByTestId("day-total-2026-07-15")).toHaveText("6.5 h", { timeout: 15000 });
  });

  test("closing a month locks it, and the lock holds on reload", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("close-2026-07").click();
    await expect(page.getByTestId("close-ok")).toBeVisible({ timeout: 15000 });

    await page.reload();
    await expect(page.getByTestId("closed-2026-07")).toBeVisible();
    await expect(page.getByTestId("close-2026-07")).toHaveCount(0);
  });

  test("a closed month refuses new hours too", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    // June is closed in the fixture.
    await page.getByTestId("entry-date").fill("2026-06-10");
    await page.getByTestId("entry-type").selectOption("Admin");
    await page.getByTestId("entry-hours").fill("2");
    await page.getByTestId("log-submit").click();

    await expect(page.getByTestId("log-error")).toContainText("closed", { timeout: 15000 });
  });
});

test.describe("timesheets — the guard", () => {
  test.use({ tolerate: ["status of 404"] });

  test("somebody without the flag gets a 404, not a 403", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/timesheets");
    expect(res?.status()).toBe(404);
  });
});

test.describe("timesheets — layout", () => {
  for (const width of [390, 1440]) {
    test(`the day tables fit at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(page, OTHER);
      await page.goto("/timesheets");

      await expect(page.getByTestId("timesheets-app")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
    });
  }
});

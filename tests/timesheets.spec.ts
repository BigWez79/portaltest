import { expect, resetStores, signInAs, test } from "./harness";

/**
 * Timesheets — the largest file on the live suite and the one people open
 * daily.
 *
 * The write tests run serially after a reset: parallel workers share one
 * fixture file, and a suite that leaves hours behind poisons the next one.
 */

/**
 * One worker, in order: two blocks below reset the timesheet store, and
 * `test.describe.serial` orders the tests inside a block without saying
 * anything about two blocks running beside each other.
 * `scripts/check-test-isolation.mjs` caught this before a flake did.
 */
test.describe.configure({ mode: "serial" });

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
    await page.getByTestId("entry-type-0").selectOption("Development");
    await page.getByTestId("entry-hours-0").fill("3.25");
    await page.getByTestId("entry-desc-0").fill("Build pipeline");
    await page.getByTestId("submit-day").click();

    await expect(page.getByTestId("log-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("day-total-2026-08-05")).toHaveText("3.25 h");
  });

  test("leave is a whole day, and the hours box goes away", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-type-0").selectOption("Annual Leave");
    await expect(page.getByTestId("entry-fixed-0")).toBeVisible();
    await expect(page.getByTestId("entry-hours-0")).toHaveCount(0);

    await page.getByTestId("entry-date").fill("2026-08-06");
    await page.getByTestId("submit-day").click();

    await expect(page.getByTestId("log-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("day-total-2026-08-06")).toHaveText("8 h");
  });

  test("a day with more hours than a day has is refused", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-date").fill("2026-08-07");
    await page.getByTestId("entry-type-0").selectOption("Project work");

    // The input carries max="24", so the browser refuses to submit and the
    // server check is never reached. That attribute is a convenience, not the
    // check — drop it and post anyway, which is what anything other than this
    // form would do. The live page has no limit at either end, so a slipped
    // decimal point logs 800 hours and the month's total is quietly nonsense.
    await page.getByTestId("entry-hours-0").evaluate((el) => el.removeAttribute("max"));
    await page.getByTestId("entry-hours-0").fill("80");
    await page.getByTestId("submit-day").click();

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
    await page.getByTestId("entry-type-0").selectOption("Admin");
    await page.getByTestId("entry-hours-0").fill("2");
    await page.getByTestId("submit-day").click();

    await expect(page.getByTestId("log-error")).toContainText("closed", { timeout: 15000 });
  });
});

test.describe.serial("timesheets — a day is the unit", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "timesheets");
  });

  test("a day with three activities goes in as one thing", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-date").fill("2026-08-20");
    await page.getByTestId("entry-type-0").selectOption("Project work");
    await page.getByTestId("entry-hours-0").fill("4");

    await page.getByTestId("add-activity").click();
    await page.getByTestId("entry-type-1").selectOption("Meeting");
    await page.getByTestId("entry-hours-1").fill("1.5");

    await page.getByTestId("add-activity").click();
    await page.getByTestId("entry-type-2").selectOption("Admin");
    await page.getByTestId("entry-hours-2").fill("2");

    // The running total is the point of building a day up before submitting it.
    await expect(page.getByTestId("day-total")).toContainText("7.5 h");

    await page.getByTestId("submit-day").click();
    await expect(page.getByTestId("log-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("day-total-2026-08-20")).toHaveText("7.5 h");

    // And the form is ready for the next day rather than still holding this one.
    await expect(page.getByTestId("activity-1")).toHaveCount(0);
  });

  test("removing an activity takes the right one out", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-type-0").selectOption("Project work");
    await page.getByTestId("entry-hours-0").fill("4");
    await page.getByTestId("add-activity").click();
    await page.getByTestId("entry-type-1").selectOption("Meeting");
    await page.getByTestId("entry-hours-1").fill("1.5");
    await page.getByTestId("add-activity").click();
    await page.getByTestId("entry-type-2").selectOption("Demo");
    await page.getByTestId("entry-hours-2").fill("3");

    // Drop the middle one. With an index as the React key the rows below would
    // shift their state up and this would leave Meeting behind instead.
    await page.getByTestId("drop-activity-1").click();

    await expect(page.getByTestId("entry-type-0")).toHaveValue("Project work");
    await expect(page.getByTestId("entry-type-1")).toHaveValue("Demo");
    await expect(page.getByTestId("entry-hours-1")).toHaveValue("3");
    await expect(page.getByTestId("activity-2")).toHaveCount(0);
  });

  test("a whole day is edited as a whole day", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    // 15 July has two activities in the fixture.
    await page.getByTestId("edit-day-2026-07-15").click();

    await expect(page.getByTestId("activity-0")).toBeVisible();
    await expect(page.getByTestId("activity-1")).toBeVisible();
    await expect(page.getByTestId("entry-date")).toHaveValue("2026-07-15");

    // Change the shape of the day, not just one row: drop an activity and
    // change what is left. The old model could do neither.
    await page.getByTestId("drop-activity-1").click();
    await page.getByTestId("entry-hours-0").fill("5");
    await page.getByTestId("submit-day").click();

    await expect(page.getByTestId("log-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("day-total-2026-07-15")).toHaveText("5 h");
  });

  test("a day already logged is not quietly replaced", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    // Submitting over a day that already has activities would wipe them without
    // saying so. Editing is how you change one, and this says which day it is.
    await page.getByTestId("entry-date").fill("2026-07-15");
    await page.getByTestId("entry-type-0").selectOption("Admin");
    await page.getByTestId("entry-hours-0").fill("2");
    await page.getByTestId("submit-day").click();

    await expect(page.getByTestId("log-error")).toContainText("2026-07-15", { timeout: 15000 });
    // Untouched: the refusal happened before anything was written.
    await expect(page.getByTestId("day-total-2026-07-15")).toHaveText("8 h");
  });

  test("a whole day can be deleted", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await expect(page.getByTestId("day-2026-07-15")).toBeVisible();
    await page.getByTestId("delete-day-2026-07-15").click();
    await expect(page.getByTestId("day-2026-07-15")).toHaveCount(0, { timeout: 15000 });
  });

  test("leave cannot share a day with work", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-date").fill("2026-08-21");
    await page.getByTestId("entry-type-0").selectOption("Annual Leave");
    await page.getByTestId("add-activity").click();
    await page.getByTestId("entry-type-1").selectOption("Project work");
    await page.getByTestId("entry-hours-1").fill("4");
    await page.getByTestId("submit-day").click();

    // Annual Leave beside four hours of project work says two contradictory
    // things about the same date, and which one reaches an invoice depends on
    // which row is read first.
    await expect(page.getByTestId("log-error")).toContainText("whole day", { timeout: 15000 });
  });

  test("a full day still posts its hours, so the rows stay lined up", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("entry-date").fill("2026-08-22");
    await page.getByTestId("entry-type-0").selectOption("Project work");
    await page.getByTestId("entry-hours-0").fill("3");
    await page.getByTestId("add-activity").click();
    await page.getByTestId("entry-type-1").selectOption("Sick");
    await page.getByTestId("add-activity").click();
    await page.getByTestId("entry-type-2").selectOption("Meeting");
    await page.getByTestId("entry-hours-2").fill("2");

    // Sick renders no hours input. If it posted nothing, the Meeting's 2 would
    // arrive against Sick and the Meeting would have no hours at all — so the
    // full-day row posts a hidden 8 to keep the parallel arrays aligned. The
    // day is refused for a different reason, and that is the proof: the server
    // saw three activities, not two.
    await page.getByTestId("submit-day").click();
    await expect(page.getByTestId("log-error")).toContainText("whole day", { timeout: 15000 });
  });
});

test.describe.serial("timesheets — the period and the rate", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "timesheets");
  });

  test("the switch changes what the period covers", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await expect(page.getByTestId("period-name")).toContainText("July 2026");
    const monthHours = await page.getByTestId("period-total").textContent();

    await page.getByTestId("period-year").click();
    await expect(page.getByTestId("period-name")).toContainText("Financial year 2026-27");

    // The year holds June as well as July, so it cannot be the same number.
    await expect(page.getByTestId("period-total")).not.toHaveText(monthHours!);
  });

  /*
   * The day-rate round trip lives in profile.spec.ts, not here.
   *
   * It writes to the profiles store, which that spec owns and resets. Two specs
   * sharing one fixture file interleave however serial either of them is, and
   * check-test-isolation.mjs cannot see this one — it catches two specs
   * *resetting* a store, not one writing to another's. So it is written down
   * here instead, next to the tests that would have caused it.
   */

  test("the financial year turns over on 6 April, not 1 April", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    // 5 April 2027 is the last day of 2026-27; 6 April starts 2027-28. A day
    // either side is the only part of this anybody gets wrong, and getting it
    // wrong puts a week of somebody's work in the wrong statement.
    await page.getByTestId("entry-date").fill("2027-04-05");
    await page.getByTestId("entry-type-0").selectOption("Project work");
    await page.getByTestId("entry-hours-0").fill("8");
    await page.getByTestId("submit-day").click();
    await expect(page.getByTestId("log-ok")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("period-year").click();
    await expect(page.getByTestId("period-name")).toContainText("Financial year 2026-27");

    await page.getByTestId("entry-date").fill("2027-04-06");
    await page.getByTestId("entry-type-0").selectOption("Project work");
    await page.getByTestId("entry-hours-0").fill("8");
    await page.getByTestId("submit-day").click();
    await expect(page.getByTestId("log-ok")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("period-year").click();
    await expect(page.getByTestId("period-name")).toContainText("Financial year 2027-28");
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

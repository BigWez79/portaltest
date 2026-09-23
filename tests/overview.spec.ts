import { expect, signInAs, test } from "./harness";

/**
 * Monthly Overview — the last app, and the only screen in the suite that shows
 * another person's figures. That it does so for an admin and not for anybody
 * else is the thing worth testing.
 */

const PLAIN = "overview.only@example.test";
const ADMIN = "everything@example.test";

test.describe("overview", () => {
  test("the month summarises your own hours", async ({ page }) => {
    await signInAs(page, PLAIN);
    await page.goto("/overview");

    await expect(page.getByTestId("overview-app")).toBeVisible();
    // 4 hours of work plus a day of leave.
    await expect(page.getByTestId("ov-logged")).toContainText("12 h");
    await expect(page.getByTestId("ov-worked")).toContainText("4 h");
    await expect(page.getByTestId("ov-days")).toContainText("2");
  });

  test("time is broken down by what it was spent on", async ({ page }) => {
    await signInAs(page, PLAIN);
    await page.goto("/overview");

    await expect(page.getByTestId("activity-routine-bau")).toContainText("4 h");
    await expect(page.getByTestId("project-month-end")).toContainText("4 h");
  });

  test("somebody who is not an admin sees nobody else", async ({ page }) => {
    await signInAs(page, PLAIN);
    await page.goto("/overview");

    await expect(page.getByTestId("everybody")).toHaveCount(0);
    // Tessa's July hours are in the fixture and must not reach this page.
    await expect(page.getByText("Tessa Timesheet")).toHaveCount(0);
  });

  test("an admin sees everybody, which is what the section is for", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto("/overview");

    await expect(page.getByTestId("everybody")).toBeVisible();
    await expect(page.getByTestId("person-timesheet.only@example.test")).toBeVisible();
    await expect(page.getByTestId("person-overview.only@example.test")).toBeVisible();
  });

  test("leave is counted in the month but not in the worked figure", async ({ page }) => {
    // Not timesheet.only@ — they have no overview flag, so that route 404s for
    // them. The two apps are granted separately and this page is the summary,
    // not the timesheet.
    await signInAs(page, PLAIN);
    await page.goto("/overview");

    await expect(page.getByTestId("ov-away")).toContainText("8 h");
    await expect(page.getByTestId("ov-worked")).toContainText("4 h");
    // Leave has no project, so it is absent from the project table entirely.
    await expect(page.getByTestId("project-month-end")).toContainText("4 h");
  });
});

test.describe("overview — the guard", () => {
  test.use({ tolerate: ["status of 404"] });

  test("somebody without the flag gets a 404, not a 403", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/overview");
    expect(res?.status()).toBe(404);
  });
});

test.describe("overview — layout", () => {
  for (const width of [390, 1440]) {
    test(`the summary fits at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(page, ADMIN);
      await page.goto("/overview");

      await expect(page.getByTestId("overview-app")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
    });
  }
});

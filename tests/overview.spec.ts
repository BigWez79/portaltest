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

test.describe("overview — everybody's month", () => {
  const ADMIN = "everything@example.test";

  test("an admin sees the team as a calendar, not a list of totals", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto("/overview");

    await expect(page.getByTestId("team-grid")).toBeVisible();

    // One row per person who logged anything, and a bar on the days they did.
    await expect(page.getByTestId("grid-overview.only@example.test")).toBeVisible();
    await expect(page.getByTestId("grid-everything@example.test")).toBeVisible();
  });

  test("weekends are left out rather than shown empty", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto("/overview");

    // July 2026 has 23 working days. The eight-odd blank weekend columns would
    // cost a fifth of the width and say nothing.
    const headers = page.locator(".ov-dayhead");
    await expect(headers).toHaveCount(23);

    const days = await page.locator(".ov-dayhead .ov-dnum").allTextContents();
    // 4 and 5 July 2026 are a Saturday and a Sunday.
    expect(days).not.toContain("4");
    expect(days).not.toContain("5");
    expect(days).toContain("3");
    expect(days).toContain("6");
  });

  test("absence is its own colour, so it stands out from every shade of work", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto("/overview");

    // overview.only@ has a day of Annual Leave in the fixture. Orange is not a
    // decoration here — it is the thing an admin opened the page to find.
    const away = page.locator('[data-activity="Annual Leave"]').first();
    await expect(away).toBeVisible();
    await expect(away).toHaveCSS("background-color", "rgb(242, 147, 60)");
  });

  test("the legend names every activity, and the totals add up to the grand total", async ({
    page,
  }) => {
    await signInAs(page, ADMIN);
    await page.goto("/overview");

    await expect(page.getByTestId("legend").locator("li")).toHaveCount(11);

    // A chart whose parts do not sum to its total is a chart nobody can trust.
    const parts = await page.locator("[data-testid^=at-]").allTextContents();
    const sum = parts.reduce((n, t) => n + Number(/([\d.]+) h/.exec(t)?.[1] ?? 0), 0);
    const grand = Number(
      /([\d.]+) h/.exec((await page.getByTestId("grand-total").textContent()) ?? "")?.[1] ?? -1,
    );
    expect(Math.round(sum * 100) / 100).toBe(grand);
  });

  test("a non-admin gets no team grid at all", async ({ page }) => {
    await signInAs(page, "overview.only@example.test");
    await page.goto("/overview");

    // Absent from the DOM, not hidden (rule 3). The personal summary stays.
    await expect(page.getByTestId("team-grid")).toHaveCount(0);
    await expect(page.getByTestId("print-overview")).toHaveCount(0);
    await expect(page.getByTestId("overview-app")).toBeVisible();
  });

  test("printing gives the grid and nothing else", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto("/overview");
    await expect(page.getByTestId("team-grid")).toBeVisible();

    await page.emulateMedia({ media: "print" });
    const shown = await page.evaluate(() => {
      const vis = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).visibility === "visible" : null;
      };
      return {
        grid: vis("[data-testid=team-grid]"),
        picker: vis("[data-testid=month-picker]"),
        button: document.querySelector("[data-testid=print-overview]")
          ? getComputedStyle(document.querySelector("[data-testid=print-overview]")!).display
          : null,
      };
    });

    expect(shown.grid, "the grid prints").toBe(true);
    expect(shown.picker, "the month picker does not").toBe(false);
    expect(shown.button, "nor does the print button itself").toBe("none");

    await page.emulateMedia({ media: "screen" });
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

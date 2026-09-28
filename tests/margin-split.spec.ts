import { type Page } from "@playwright/test";
import { axeScan, expect, resetStores, signInAs, signOutCompletely, test } from "./harness";

/**
 * Margin Split, /admin/margin-split. The seed is one job of £8.00 at 12.5% — a
 * pot of exactly 100p — three contractors on 33.34/33.33/33.33%, and 80p of
 * drawings: A 10p cash and 20p transfer, B 50p transfer.
 */

const ADMIN = "admin.only@example.test";

// Every test reads the one pot and some change it, so the file runs in order
// from the seed: a read beside a write would see a pot that is neither.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => {
  await resetStores(page, "margin-split");
});
const ROUTE = "/admin/margin-split";

function row(page: Page, name: string, cell: string) {
  return page.getByTestId(`row-${name}`).getByTestId(cell);
}

test.describe("margin split — reading", () => {
  test("100p split three equal ways is 34/33/33, and totals exactly 100", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await expect(page.getByTestId("pot-total")).toHaveText("£1.00");
    await expect(row(page, "Contractor A", "allocated")).toHaveText("£0.34");
    await expect(row(page, "Contractor B", "allocated")).toHaveText("£0.33");
    await expect(row(page, "Contractor C", "allocated")).toHaveText("£0.33");
    await expect(page.getByTestId("allocated-total")).toHaveText("£1.00");
  });

  test("an overdrawn balance says so, with no minus sign", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    // 33p allocated, 50p drawn.
    await expect(row(page, "Contractor B", "balance")).toHaveText("overdrawn £0.17");
    await expect(page.getByTestId("margin-split")).not.toContainText("-£");
    await expect(row(page, "Contractor A", "balance")).toHaveText("£0.04");
  });

  test("cash and transfer are totalled apart, and the pot remaining reconciles", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await expect(row(page, "Contractor A", "cash")).toHaveText("£0.10");
    await expect(row(page, "Contractor A", "transfer")).toHaveText("£0.20");
    await expect(row(page, "Contractor A", "drawn")).toHaveText("£0.30");
    await expect(row(page, "Contractor B", "cash")).toHaveText("£0.00");
    await expect(row(page, "Contractor B", "transfer")).toHaveText("£0.50");
    await expect(page.getByTestId("pot-drawn")).toHaveText("£0.80");
    await expect(page.getByTestId("pot-remaining")).toHaveText("£0.20");
  });

  test("the admin screen links to it", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto("/admin");
    await page.getByTestId("margin-split-link").click();
    await expect(page.getByTestId("margin-split")).toBeVisible();
  });

  test("passes an accessibility scan", async ({ page }, testInfo) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await expect(page.getByTestId("margin-split")).toBeVisible();
    await axeScan(page, testInfo, "margin-split");
  });
});

test.describe("margin split — who may open it", () => {
  test.use({ tolerate: ["status of 404"] });

  // margin.only holds the calculator's flag, which is not this page.
  for (const email of ["no.flags@example.test", "margin.only@example.test", "left.the.company@example.test"]) {
    test(`404s for ${email}`, async ({ page }) => {
      await signInAs(page, email);
      const res = await page.goto(ROUTE);
      expect(res?.status()).toBe(404);
      await expect(page.getByTestId("margin-split")).toHaveCount(0);
    });
  }

  test("signed out, it shows the sign-in page and nothing of the pot", async ({ page }) => {
    await signOutCompletely(page);
    await page.goto(ROUTE);
    await expect(page.getByTestId("login-view")).toBeVisible();
    await expect(page.getByTestId("margin-split")).toHaveCount(0);
  });
});

test.describe("margin split — widths", () => {
  for (const width of [390, 768, 1024, 1440]) {
    test(`no horizontal scroll at ${width}`, async ({ page }, testInfo) => {
      await signInAs(page, ADMIN);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(ROUTE);
      await expect(page.getByTestId("summary-table")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll horizontally").toBeLessThanOrEqual(0);
      await testInfo.attach(`margin-split-${width}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
});

test.describe.serial("margin split — writing", () => {
  test("a job adds value × margin, half-up, and ties go to the first listed", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    // 5p at 10% is half a penny, which rounds up: the pot becomes 101p.
    await page.getByTestId("job-name").fill("Half a penny");
    await page.getByTestId("job-date").fill("2026-09-10");
    await page.getByTestId("job-value").fill("0.05");
    await page.getByTestId("job-margin").fill("10");
    await page.getByTestId("job-submit").click();
    await expect(page.getByTestId("job-ok")).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("pot-total")).toHaveText("£1.01");
    // Floors 33/33/33; two pennies left. A has the largest remainder, B and C
    // tie on the next, and B is listed first.
    await expect(row(page, "Contractor A", "allocated")).toHaveText("£0.34");
    await expect(row(page, "Contractor B", "allocated")).toHaveText("£0.34");
    await expect(row(page, "Contractor C", "allocated")).toHaveText("£0.33");
    await expect(page.getByTestId("allocated-total")).toHaveText("£1.01");
  });

  test("a cash drawing lands in cash and can overdraw the pot", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await page.getByTestId("drawing-contractor").selectOption({ label: "Contractor C" });
    await page.getByTestId("drawing-date").fill("2026-09-12");
    await page.getByTestId("drawing-amount").fill("0.40");
    await page.getByTestId("drawing-method").selectOption("cash");
    await page.getByTestId("drawing-submit").click();
    await expect(page.getByTestId("drawing-ok")).toBeVisible({ timeout: 15000 });

    await expect(row(page, "Contractor C", "cash")).toHaveText("£0.40");
    await expect(row(page, "Contractor C", "transfer")).toHaveText("£0.00");
    await expect(row(page, "Contractor C", "balance")).toHaveText("overdrawn £0.07");
    await expect(page.getByTestId("pot-remaining")).toHaveText("overdrawn £0.20");
  });

  test("shares that do not total 100% are refused, and nothing changes", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await page.getByTestId("share-0").fill("50");
    await page.getByTestId("share-1").fill("30");
    await page.getByTestId("share-2").fill("10");
    await page.getByTestId("shares-submit").click();
    await expect(page.getByTestId("shares-error")).toContainText("90.00%", { timeout: 15000 });

    await page.reload();
    await expect(row(page, "Contractor A", "allocated")).toHaveText("£0.34");
  });

  test("shares that total 100% are saved and re-split the pot", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await page.getByTestId("share-0").fill("50");
    await page.getByTestId("share-1").fill("25");
    await page.getByTestId("share-2").fill("25");
    await page.getByTestId("shares-submit").click();
    await expect(page.getByTestId("shares-ok")).toBeVisible({ timeout: 15000 });
    await expect(row(page, "Contractor A", "allocated")).toHaveText("£0.50");
    await expect(row(page, "Contractor C", "allocated")).toHaveText("£0.25");
  });

  test("a new contractor starts on 0%, and Split equally puts all four level", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await page.getByTestId("contractor-name").fill("Contractor D");
    await page.getByTestId("contractor-submit").click();
    await expect(page.getByTestId("contractor-ok")).toBeVisible({ timeout: 15000 });
    await expect(row(page, "Contractor D", "allocated")).toHaveText("£0.00");
    await expect(page.getByTestId("allocated-total")).toHaveText("£1.00");

    await page.getByTestId("shares-equal").click();
    await page.getByTestId("shares-submit").click();
    await expect(page.getByTestId("shares-ok")).toBeVisible({ timeout: 15000 });
    await expect(row(page, "Contractor D", "allocated")).toHaveText("£0.25");
    await expect(page.getByTestId("allocated-total")).toHaveText("£1.00");
  });

  /**
   * Rule 5. A non-admin never gets the page, so the forms are loaded as an
   * admin and the session is then swapped underneath them: every post after
   * that arrives as somebody who is not an admin. Were the actions trusting
   * the page, the job, drawing, contractor and rename would all land, and the
   * checks after signing back in would see them.
   */
  test("every action refuses a non-admin, even with the form in hand", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await signInAs(page, "no.flags@example.test");

    await page.getByTestId("job-name").fill("Not allowed");
    await page.getByTestId("job-date").fill("2026-09-10");
    await page.getByTestId("job-value").fill("1000");
    await page.getByTestId("job-margin").fill("50");
    await page.getByTestId("job-submit").click();
    await expect(page.getByTestId("job-error")).toHaveText(/Only an admin/, { timeout: 15000 });

    await page.getByTestId("drawing-date").fill("2026-09-10");
    await page.getByTestId("drawing-amount").fill("5");
    await page.getByTestId("drawing-submit").click();
    await expect(page.getByTestId("drawing-error")).toHaveText(/Only an admin/, { timeout: 15000 });

    await page.getByTestId("share-name-0").fill("Renamed");
    await page.getByTestId("shares-submit").click();
    await expect(page.getByTestId("shares-error")).toHaveText(/Only an admin/, { timeout: 15000 });

    await page.getByTestId("contractor-name").fill("Contractor Z");
    await page.getByTestId("contractor-submit").click();
    await expect(page.getByTestId("contractor-error")).toHaveText(/Only an admin/, { timeout: 15000 });

    await signInAs(page, ADMIN);
    await page.goto(ROUTE);
    await expect(page.getByTestId("pot-total")).toHaveText("£1.00");
    await expect(page.getByTestId("pot-drawn")).toHaveText("£0.80");
    await expect(page.getByTestId("row-Renamed")).toHaveCount(0);
    await expect(page.getByTestId("row-Contractor Z")).toHaveCount(0);
  });
});

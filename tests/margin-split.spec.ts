import { expect, resetStores, signInAs, signOutCompletely, test } from "./harness";
import {
  allocate,
  contribution,
  equalShares,
  formatBalance,
  parseBp,
  parsePence,
  type MsContractor,
} from "../src/lib/margin-split-calc";

/**
 * Margin Split — /admin/margin-split. Jobs feed a pot, contractors draw from it.
 *
 * The seed (tests/fixtures/margin-split.json) is chosen so the figures prove
 * something rather than merely appear:
 *
 *   Northgate rewire      £12,000.00 × 12.5% = £1,500.00
 *   Harbour Road survey    £3,333.32 × 12.5% = 41,666.5p -> £416.67
 *                          (half-up; banker's rounding would give £416.66)
 *   pot                                          £1,916.67
 *
 *   Alex   33.34%  63,901 r7778 -> +1 -> £639.02
 *   Billie 33.33%  63,882 r6111 -> +1 -> £638.83   ties with Casey; listed first
 *   Casey  33.33%  63,882 r6111       -> £638.82
 *
 *   Alex   drew £400.00 cash + £300.00 transfer -> overdrawn £60.98
 *   Billie drew £38.83 cash + £500.00 transfer  -> £100.00
 *   Casey  drew nothing                         -> £638.82
 *   pot remaining £1,916.67 − £1,238.83         =  £677.84
 */

const ADMIN = "everything@example.test";
const NOT_ADMIN = "margin.only@example.test"; // has the Margin calculator, not admin

const ALEX = "c5000001-0000-4000-8000-000000000001";
const BILLIE = "c5000002-0000-4000-8000-000000000002";
const CASEY = "c5000003-0000-4000-8000-000000000003";
const NORTHGATE = "d5000001-0000-4000-8000-000000000001";
const HARBOUR = "d5000002-0000-4000-8000-000000000002";
const BILLIE_CASH = "e5000004-0000-4000-8000-000000000004";

function three(): MsContractor[] {
  return equalShares(3).map((shareBp, i) => ({
    id: `c${i}`,
    name: `C${i}`,
    shareBp,
    position: i + 1,
  }));
}

test.describe("margin split — the arithmetic", () => {
  test("100p split three equal ways is 34/33/33 and totals exactly 100", () => {
    const out = allocate(100, three());
    expect([...out.values()]).toEqual([34, 33, 33]);
    expect([...out.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("equal shares are 3334/3333/3333, the first listed taking the spare point", () => {
    expect(equalShares(3)).toEqual([3334, 3333, 3333]);
    expect(equalShares(4)).toEqual([2500, 2500, 2500, 2500]);
  });

  test("allocations sum to the pot for every pot from 0 to 2000p", () => {
    // Every total, not a sample: a remainder rule that drops or invents a
    // penny does it on some pots and not others.
    const shares = [
      three(),
      [1250, 2750, 6000].map((shareBp, i) => ({ id: `x${i}`, name: "", shareBp, position: i })),
    ];
    for (const set of shares) {
      for (let pot = 0; pot <= 2000; pot++) {
        const sum = [...allocate(pot, set).values()].reduce((a, b) => a + b, 0);
        expect(sum, `pot ${pot}`).toBe(pot);
      }
    }
  });

  test("a tie in remainders goes to whoever is listed first", () => {
    // Two 50% shares and an odd penny: both remainders are 5000. The listing
    // order decides it, not the order the rows arrived in.
    const set: MsContractor[] = [
      { id: "b", name: "", shareBp: 5000, position: 2 },
      { id: "a", name: "", shareBp: 5000, position: 1 },
    ];
    const out = allocate(1, set);
    expect(out.get("a")).toBe(1);
    expect(out.get("b")).toBe(0);
  });

  test("a job's contribution rounds half-up, in integers", () => {
    expect(contribution(333332, 1250)).toBe(41667); // 41666.5
    expect(contribution(333331, 1250)).toBe(41666); // 41666.375
    expect(contribution(1000, 1000)).toBe(100);
    // Past where a float multiplication starts losing pennies.
    expect(contribution(99_999_999_999, 9999)).toBe(99_989_999_999);
  });

  test("shares that do not total 100% are refused, not quietly split", () => {
    const bad = three().map((c, i) => (i === 0 ? { ...c, shareBp: 4000 } : c));
    expect(() => allocate(100, bad)).toThrow();
  });

  test("figures are read as typed, not through a float", () => {
    expect(parsePence("1,234.5")).toBe(123450);
    expect(parsePence("0.10")).toBe(10);
    expect(parsePence("1.234")).toBeNull();
    expect(parseBp("12.5")).toBe(1250);
    expect(parseBp("100")).toBe(10000);
    expect(parseBp("100.01")).toBeNull();
    expect(formatBalance(-6098)).toBe("overdrawn £60.98");
  });
});

test.describe("margin split — who may open it", () => {
  test.use({ tolerate: ["status of 404"] });

  test("a non-admin gets a 404, even with the Margin calculator's flag", async ({ page }) => {
    await signInAs(page, NOT_ADMIN);
    const res = await page.goto("/admin/margin-split");
    expect(res?.status(), "a 404, not a 403").toBe(404);
    await expect(page.getByTestId("ms-app")).toHaveCount(0);
  });

  test("somebody signed out is sent to sign in, and sees none of it", async ({ page }) => {
    // The proxy turns signed-out traffic round before the route runs, as it
    // does for every app route (app-routes.spec.ts).
    await signOutCompletely(page);
    await page.goto("/admin/margin-split");
    await expect(page.getByTestId("login-view")).toBeVisible();
    await expect(page.getByTestId("ms-app")).toHaveCount(0);
  });

  test("a deactivated admin gets a 404", async ({ page }) => {
    await signInAs(page, "left.the.company@example.test");
    const res = await page.goto("/admin/margin-split");
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("ms-app")).toHaveCount(0);
  });

  test("an admin reaches it from the staff access screen", async ({ page }) => {
    await signInAs(page, ADMIN);
    await page.goto("/admin");
    await page.getByTestId("link-margin-split").click();
    await expect(page.getByTestId("ms-app")).toBeVisible({ timeout: 15000 });
  });
});

test.describe("margin split — layout", () => {
  for (const width of [390, 768, 1024, 1440]) {
    test(`no horizontal scroll at ${width}`, async ({ page }, testInfo) => {
      await signInAs(page, ADMIN);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/margin-split");
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

test.describe.serial("margin split — the figures, and changing them", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "marginSplit");
    await signInAs(page, ADMIN);
    await page.goto("/admin/margin-split");
    await expect(page.getByTestId("ms-app")).toBeVisible();
  });

  test("the seeded pot reconciles to the penny", async ({ page }) => {
    await expect(page.getByTestId(`contribution-${NORTHGATE}`)).toHaveText("£1,500.00");
    await expect(page.getByTestId(`contribution-${HARBOUR}`)).toHaveText("£416.67");
    await expect(page.getByTestId("pot-total")).toHaveText("£1,916.67");

    await expect(page.getByTestId(`alloc-${ALEX}`)).toHaveText("£639.02");
    await expect(page.getByTestId(`alloc-${BILLIE}`)).toHaveText("£638.83");
    await expect(page.getByTestId(`alloc-${CASEY}`)).toHaveText("£638.82");

    await expect(page.getByTestId("drawn-total")).toHaveText("£1,238.83");
    await expect(page.getByTestId("pot-remaining")).toHaveText("£677.84");
  });

  test("an overdrawn balance is said in words, not with a minus", async ({ page }) => {
    await expect(page.getByTestId(`balance-${ALEX}`)).toHaveText("overdrawn £60.98");
    await expect(page.getByTestId(`balance-${BILLIE}`)).toHaveText("£100.00");
    await expect(page.getByTestId(`balance-${CASEY}`)).toHaveText("£638.82");
    await expect(page.getByTestId("summary-table")).not.toContainText("-£");
  });

  test("drawings are split into cash and transfer", async ({ page }) => {
    await expect(page.getByTestId(`cash-${ALEX}`)).toHaveText("£400.00");
    await expect(page.getByTestId(`transfer-${ALEX}`)).toHaveText("£300.00");
    await expect(page.getByTestId(`drawn-${ALEX}`)).toHaveText("£700.00");
    await expect(page.getByTestId(`cash-${BILLIE}`)).toHaveText("£38.83");
    await expect(page.getByTestId(`transfer-${BILLIE}`)).toHaveText("£500.00");
    await expect(page.getByTestId(`drawn-${CASEY}`)).toHaveText("£0.00");
  });

  test("a pot of 100p on the page splits 34/33/33", async ({ page }) => {
    await page.getByTestId(`remove-job-${NORTHGATE}`).click();
    await expect(page.getByTestId(`job-${NORTHGATE}`)).toHaveCount(0, { timeout: 15000 });
    await page.getByTestId(`remove-job-${HARBOUR}`).click();
    await expect(page.getByTestId(`job-${HARBOUR}`)).toHaveCount(0, { timeout: 15000 });

    await page.getByTestId("job-name").fill("One pound");
    await page.getByTestId("job-date").fill("2026-09-01");
    await page.getByTestId("job-value").fill("10.00");
    await page.getByTestId("job-margin").fill("10");
    await page.getByTestId("job-submit").click();
    await expect(page.getByTestId("job-ok")).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("pot-total")).toHaveText("£1.00");
    await expect(page.getByTestId(`alloc-${ALEX}`)).toHaveText("£0.34");
    await expect(page.getByTestId(`alloc-${BILLIE}`)).toHaveText("£0.33");
    await expect(page.getByTestId(`alloc-${CASEY}`)).toHaveText("£0.33");
  });

  test("a cash drawing moves the cash total, the balance and the pot", async ({ page }) => {
    await page.getByTestId("draw-contractor").selectOption(CASEY);
    await page.getByTestId("draw-date").fill("2026-09-10");
    await page.getByTestId("draw-amount").fill("700.00");
    await page.getByTestId("draw-method").selectOption("cash");
    await page.getByTestId("draw-submit").click();
    await expect(page.getByTestId("draw-ok")).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId(`cash-${CASEY}`)).toHaveText("£700.00");
    await expect(page.getByTestId(`transfer-${CASEY}`)).toHaveText("£0.00");
    await expect(page.getByTestId(`balance-${CASEY}`)).toHaveText("overdrawn £61.18");
    // £677.84 − £700.00
    await expect(page.getByTestId("pot-remaining")).toHaveText("overdrawn £22.16");

    await page.reload();
    await expect(page.getByTestId(`cash-${CASEY}`)).toHaveText("£700.00");
  });

  test("shares that do not total 100% are refused, and nothing changes", async ({ page }) => {
    await page.getByTestId("contractor-share-0").fill("40");
    await expect(page.getByTestId("contractors-total")).toContainText("106.66%");
    await page.getByTestId("contractors-save").click();
    await expect(page.getByTestId("contractors-error")).toContainText("exactly 100%", {
      timeout: 15000,
    });

    await page.reload();
    await expect(page.getByTestId(`alloc-${ALEX}`)).toHaveText("£639.02");
  });

  test("a fourth contractor can be added, and an equal split still reconciles", async ({ page }) => {
    await page.getByTestId("contractor-name-3").fill("Dana Frost");
    await page.getByTestId("split-equally").click();
    await expect(page.getByTestId("contractor-share-0")).toHaveValue("25.00");
    await expect(page.getByTestId("contractor-share-3")).toHaveValue("25.00");
    await page.getByTestId("contractors-save").click();
    await expect(page.getByTestId("contractors-ok")).toBeVisible({ timeout: 15000 });

    // 191,667 × 25% = 47,916.75 each; three spare pennies go to the first three.
    await expect(page.getByTestId(`alloc-${ALEX}`)).toHaveText("£479.17");
    await expect(page.getByTestId(`alloc-${CASEY}`)).toHaveText("£479.17");
    const dana = page.getByTestId("summary-table").getByRole("row", { name: /Dana Frost/ });
    await expect(dana).toContainText("£479.16");
  });

  test("the server actions refuse somebody who is not an admin", async ({ page }) => {
    // A non-admin cannot reach the forms — the page 404s for them. So the form
    // is loaded as an admin and the session swapped underneath it: the post
    // then arrives from a non-admin, which is what anything other than this
    // page would send (rule 5). With the check in submitJob deleted, the job
    // would be saved and the pot below would move.
    await signInAs(page, NOT_ADMIN);

    await page.getByTestId("job-name").fill("Should not land");
    await page.getByTestId("job-date").fill("2026-09-01");
    await page.getByTestId("job-value").fill("1000.00");
    await page.getByTestId("job-margin").fill("50");
    await page.getByTestId("job-submit").click();
    await expect(page.getByTestId("job-error")).toContainText("Only an admin", { timeout: 15000 });

    await page.getByTestId(`remove-drawing-${BILLIE_CASH}`).click();
    await expect(page.getByTestId(`remove-drawing-${BILLIE_CASH}-error`)).toContainText(
      "Only an admin",
      { timeout: 15000 },
    );

    await page.getByTestId("contractor-share-0").fill("33.33");
    await page.getByTestId("contractor-share-2").fill("33.34");
    await page.getByTestId("contractors-save").click();
    await expect(page.getByTestId("contractors-error")).toContainText("Only an admin", {
      timeout: 15000,
    });

    await signInAs(page, ADMIN);
    await page.reload();
    await expect(page.getByTestId("pot-total")).toHaveText("£1,916.67");
    await expect(page.getByTestId(`drawing-${BILLIE_CASH}`)).toBeVisible();
    await expect(page.getByTestId(`alloc-${ALEX}`)).toHaveText("£639.02");
  });
});

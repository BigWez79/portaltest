import type { Page } from "@playwright/test";
import { expect, signInAs, test } from "./harness";

/**
 * Margin & Profit Split — the ported calculator.
 *
 * The three worked examples below are not hand-derived. They were read off the
 * live `margin.html` running in a headless browser with every http(s) request
 * aborted, so the expectations here are that page's own output. If a change to
 * `src/lib/margin-model.ts` moves one of these figures, the port has stopped
 * agreeing with the app it replaced.
 *
 * Each example is fed in by planting the live page's own localStorage payload
 * before the app boots, which checks the storage format at the same time: a
 * browser that has used the live page keeps its figures.
 */

const STORE_KEY = "marginSplitCalc_v2";

type Stored = Record<string, unknown>;

/** The live page's saved-state shape, planted before any script runs. */
async function seed(page: Page, stored: Stored) {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, JSON.stringify(value));
    },
    [STORE_KEY, stored] as const,
  );
}

const EXAMPLE_ONE: Stored = {
  startDate: "2026-06-01",
  revenue: 400000,
  split: 25,
  nameA: "Owner A",
  nameB: "Owner B",
  staff: [
    { name: "A1", rate: 1000, m1: 10, m2: 10, m3: 10, fifty: false, owner: "" },
    { name: "A2", rate: 500, m1: 20, m2: 0, m3: 0, fifty: false, owner: "" },
  ],
  carry: [],
  inv: [],
  debtA: [],
  debtB: [],
};

/** Owner credits, a 50/50 pool, carryover, investments and debts, all at once. */
const EXAMPLE_TWO: Stored = {
  startDate: "2026-06-01",
  revenue: 250000,
  split: 40,
  nameA: "Alex",
  nameB: "Bev",
  staff: [
    { name: "S1", rate: 800, m1: 15, m2: 15, m3: 15, fifty: true, owner: "A" },
    { name: "S2", rate: 300, m1: 10, m2: 10, m3: 0, fifty: true, owner: "" },
    { name: "S3", rate: 450, m1: 20, m2: 20, m3: 20, fifty: false, owner: "B" },
  ],
  carry: [{ name: "c", amount: "10000" }],
  inv: [{ name: "i", amount: "25000" }],
  debtA: [{ name: "da", amount: "5000" }],
  debtB: [{ name: "db", amount: "7500" }],
};

/** `toHaveValues` is for a multi-select; these are separate inputs. */
async function inputValues(page: Page, testId: string) {
  return page.getByTestId(testId).evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value),
  );
}

async function readValues(page: Page, ids: string[]) {
  const out: Record<string, string> = {};
  for (const id of ids) out[id] = (await page.getByTestId(id).innerText()).trim();
  return out;
}

/**
 * Goes to the calculator and waits for it to have restored what was seeded.
 * The first paint shows PRESET — its own quarter, its own figures — and the
 * saved state arrives an effect later, so a read taken on `toBeVisible()` alone
 * can catch a mix of the two.
 */
async function gotoMargin(page: Page) {
  await page.goto("/margin");
  await expect(page.getByTestId("margin-calculator")).toHaveAttribute("data-hydrated", "1");
}

test.describe("margin — the worked examples", () => {
  test("example 1: revenue, two staff lines, a 25/75 split", async ({ page }) => {
    await signInAs(page, "margin.only@example.test");
    await seed(page, EXAMPLE_ONE);
    await gotoMargin(page);

    // The quarter, and the working days in it.
    expect(
      await readValues(page, ["workingDays", "quarterRange", "colM1", "colM2", "colM3"]),
    ).toEqual({
      workingDays: "66 days",
      quarterRange: "1 Jun 2026 – 31 Aug 2026",
      colM1: "Jun days\n22 avail",
      colM2: "Jul days\n23 avail",
      colM3: "Aug days\n21 avail",
    });

    // Per-line days and cost.
    expect(await page.getByTestId("s-days").allInnerTexts()).toEqual(["30", "20"]);
    expect(await page.getByTestId("qc-cost").allInnerTexts()).toEqual(["£30,000", "£10,000"]);

    expect(
      await readValues(page, [
        "revAnnual",
        "staffTotal",
        "staffDays",
        "availDays",
        "kRev",
        "kRevQ",
        "kStaff",
        "kMargin",
        "kMarginPc",
        "kNet",
        "wfRev",
        "wfStaff",
        "wfMargin",
        "wfInv",
        "wfNet",
        "wfDebtRepay",
        "wfSplit",
        "amtA",
        "amtB",
        "totalDist",
        "brkA",
        "brkB",
      ]),
    ).toEqual({
      revAnnual: "£1,600,000",
      staffTotal: "£40,000",
      staffDays: "50",
      availDays: "66",
      kRev: "£400,000",
      kRevQ: "per quarter",
      kStaff: "£40,000",
      kMargin: "£360,000",
      kMarginPc: "90.0% margin",
      kNet: "£360,000",
      wfRev: "£400,000",
      wfStaff: "− £40,000",
      wfMargin: "£360,000",
      wfInv: "− £0",
      wfNet: "£360,000",
      wfDebtRepay: "− £0",
      wfSplit: "£360,000",
      amtA: "£90,000",
      amtB: "£270,000",
      totalDist: "£360,000",
      brkA: "25% of split (£90,000)",
      brkB: "75% of split (£270,000)",
    });

    // Nothing was set aside, so none of those lines are drawn at all.
    for (const id of ["credARow", "credBRow", "wfCarryRow", "wfOwnerARow", "wfOwnerBRow", "wf50row"]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
  });

  test("example 2: owner credits, a 50/50 pool, carryover, investments and debts", async ({
    page,
  }) => {
    await signInAs(page, "margin.only@example.test");
    await seed(page, EXAMPLE_TWO);
    await gotoMargin(page);

    expect(await page.getByTestId("s-days").allInnerTexts()).toEqual(["45", "20", "60"]);
    expect(await page.getByTestId("qc-cost").allInnerTexts()).toEqual([
      "£36,000",
      "£6,000",
      "£27,000",
    ]);
    expect(await page.getByTestId("qc-owner").allInnerTexts()).toEqual([
      "→ credited to Alex",
      "→ credited to Bev",
    ]);
    expect(await page.getByTestId("qc-fifty").allInnerTexts()).toEqual([
      "21d × £800 = £16,800 (50/50)",
      "46d × £300 = £13,800 (50/50)",
    ]);

    expect(
      await readValues(page, [
        "staffPeriodLabel",
        "staffTotal",
        "staffDays",
        "credA",
        "credB",
        "carryTotal",
        "invTotal",
        "debtATotal",
        "debtBTotal",
        "kRev",
        "kStaff",
        "kMargin",
        "kMarginPc",
        "kNet",
        "wfRev",
        "wfCarry",
        "wfStaff",
        "wfMargin",
        "wfInv",
        "wfNet",
        "wfDebtRepay",
        "wfOwnerA",
        "wfOwnerB",
        "wf50",
        "wfSplit",
        "amtA",
        "amtB",
        "totalDist",
        "brkA",
        "brkB",
      ]),
    ).toEqual({
      staffPeriodLabel: "(per quarter)",
      staffTotal: "£6,000",
      staffDays: "125",
      credA: "£36,000",
      credB: "£27,000",
      carryTotal: "£10,000",
      invTotal: "£25,000",
      debtATotal: "£5,000",
      debtBTotal: "£7,500",
      kRev: "£260,000",
      kStaff: "£6,000",
      kMargin: "£254,000",
      kMarginPc: "97.7% margin",
      kNet: "£229,000",
      wfRev: "£250,000",
      wfCarry: "+ £10,000",
      wfStaff: "− £6,000",
      wfMargin: "£254,000",
      wfInv: "− £25,000",
      wfNet: "£229,000",
      wfDebtRepay: "− £12,500",
      wfOwnerA: "− £36,000",
      wfOwnerB: "− £27,000",
      wf50: "− £30,600",
      wfSplit: "£122,900",
      amtA: "£105,460",
      amtB: "£123,540",
      totalDist: "£229,000",
      brkA: "40% of split (£49,160) + £36,000 staff + £5,000 debt back + £15,300 (50/50)",
      brkB: "60% of split (£73,740) + £27,000 staff + £7,500 debt back + £15,300 (50/50)",
    });

    // The whole point of the waterfall: what goes out equals what was there.
    expect(await page.getByTestId("totalDist").innerText()).toBe(
      await page.getByTestId("kNet").innerText(),
    );
  });

  test("example 3: the same figures in the annual view", async ({ page }) => {
    await signInAs(page, "margin.only@example.test");
    await seed(page, EXAMPLE_TWO);
    await gotoMargin(page);
    await page.getByTestId("period-annual").click();

    expect(
      await readValues(page, [
        "staffPeriodLabel",
        "staffTotal",
        "credA",
        "credB",
        "kRev",
        "kRevQ",
        "kStaff",
        "kMargin",
        "kMarginPc",
        "kNet",
        "wfRev",
        "wfCarry",
        "wfStaff",
        "wfMargin",
        "wfInv",
        "wfNet",
        "wfDebtRepay",
        "wfOwnerA",
        "wfOwnerB",
        "wf50",
        "wfSplit",
        "amtA",
        "amtB",
        "totalDist",
        "brkA",
        "brkB",
      ]),
    ).toEqual({
      staffPeriodLabel: "(full year)",
      // Revenue, staff cost and owner staff credits scale by four. Carryover,
      // investments, debts and the 50/50 pool are flat, exactly as on the live
      // page — see the note at the top of src/lib/margin-model.ts.
      staffTotal: "£24,000",
      credA: "£144,000",
      credB: "£108,000",
      kRev: "£1,010,000",
      kRevQ: "per year",
      kStaff: "£24,000",
      kMargin: "£986,000",
      kMarginPc: "97.6% margin",
      kNet: "£961,000",
      wfRev: "£1,000,000",
      wfCarry: "+ £10,000",
      wfStaff: "− £24,000",
      wfMargin: "£986,000",
      wfInv: "− £25,000",
      wfNet: "£961,000",
      wfDebtRepay: "− £12,500",
      wfOwnerA: "− £144,000",
      wfOwnerB: "− £108,000",
      wf50: "− £30,600",
      wfSplit: "£665,900",
      amtA: "£430,660",
      amtB: "£530,340",
      totalDist: "£961,000",
      brkA: "40% of split (£266,360) + £144,000 staff + £5,000 debt back + £15,300 (50/50)",
      brkB: "60% of split (£399,540) + £108,000 staff + £7,500 debt back + £15,300 (50/50)",
    });
  });
});

test.describe("margin — the defaults", () => {
  /**
   * The live page ships pre-filled with a real quarter's revenue, a real owner
   * split and a real debt to a named person, on a page with no sign-in in a
   * public repository. This is the check that stops any of that arriving here.
   */
  const LIVE_FIGURES = ["412500", "412,500", "1,650,000", "1075", "22000", "22,000", "Andy"];

  test("a first visit shows obvious placeholders, not a real quarter", async ({ page }) => {
    await signInAs(page, "margin.only@example.test");
    await gotoMargin(page);

    await expect(page.getByTestId("revenue")).toHaveValue("100000");
    await expect(page.getByTestId("splitRange")).toHaveValue("50");
    await expect(page.getByTestId("nameA")).toHaveValue("Owner A");
    await expect(page.getByTestId("nameB")).toHaveValue("Owner B");
    expect(await inputValues(page, "s-name")).toEqual(["Example staff 1", "Example staff 2"]);
    expect(await inputValues(page, "s-rate")).toEqual(["500", "250"]);

    // No debts, investments or carryover are pre-filled.
    for (const id of ["carry-row", "inv-row", "debtA-row", "debtB-row"]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }

    const body = await page.locator("body").innerText();
    const inputs = await page.locator("input").evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).value).join(" "),
    );
    for (const figure of LIVE_FIGURES) {
      expect(`${body} ${inputs}`, `the live page's ${figure} must not ship here`).not.toContain(
        figure,
      );
    }
  });

  test("reset puts the placeholders back", async ({ page }) => {
    await signInAs(page, "margin.only@example.test");
    await seed(page, EXAMPLE_TWO);
    await gotoMargin(page);
    await expect(page.getByTestId("revenue")).toHaveValue("250000");

    await page.getByTestId("margin-reset").click();

    await expect(page.getByTestId("revenue")).toHaveValue("100000");
    await expect(page.getByTestId("nameA")).toHaveValue("Owner A");
    expect(await inputValues(page, "s-name")).toEqual(["Example staff 1", "Example staff 2"]);
  });

  test("an edit is remembered in this browser", async ({ page }) => {
    await signInAs(page, "margin.only@example.test");
    await gotoMargin(page);

    await page.getByTestId("revenue").fill("123000");
    await expect(page.getByTestId("kRev")).toHaveText("£123,000");
    await expect(page.getByTestId("saved-flag")).toHaveClass(/show/);

    await page.reload();
    await expect(page.getByTestId("revenue")).toHaveValue("123000");
  });
});

test.describe("margin — editing", () => {
  test("staff, items and the split all recalculate", async ({ page }) => {
    await signInAs(page, "margin.only@example.test");
    await seed(page, EXAMPLE_ONE);
    await gotoMargin(page);

    // Drop the second staff line: £10,000 of cost goes with it.
    await page.getByTestId("s-del").nth(1).click();
    await expect(page.getByTestId("staff-row")).toHaveCount(1);
    await expect(page.getByTestId("staffTotal")).toHaveText("£30,000");
    await expect(page.getByTestId("kMargin")).toHaveText("£370,000");

    // An investment comes off the margin but not the margin percentage.
    await page.getByTestId("add-inv").click();
    await page.getByTestId("inv-row").getByLabel("Amount").fill("70000");
    await expect(page.getByTestId("invTotal")).toHaveText("£70,000");
    await expect(page.getByTestId("kNet")).toHaveText("£300,000");

    // A debt is not deducted — it is paid back on top of that owner's share.
    await page.getByTestId("add-debtA").click();
    await page.getByTestId("debtA-row").getByLabel("Amount").fill("50000");
    await expect(page.getByTestId("kNet")).toHaveText("£300,000");
    await expect(page.getByTestId("wfSplit")).toHaveText("£250,000");
    await expect(page.getByTestId("amtA")).toHaveText("£112,500"); // 25% of 250,000 + 50,000
    await expect(page.getByTestId("amtB")).toHaveText("£187,500");
    await expect(page.getByTestId("totalDist")).toHaveText("£300,000");

    // The two share boxes always total 100.
    await page.getByTestId("pcInB").fill("90");
    await expect(page.getByTestId("pcInA")).toHaveValue("10");
    await expect(page.getByTestId("splitRange")).toHaveValue("10");
  });

  test("crediting a staff line to an owner takes it out of the business cost", async ({
    page,
  }) => {
    await signInAs(page, "margin.only@example.test");
    await seed(page, EXAMPLE_ONE);
    await gotoMargin(page);
    await expect(page.getByTestId("staffTotal")).toHaveText("£40,000");

    await page.getByTestId("s-owner").first().selectOption("A");

    await expect(page.getByTestId("staffTotal")).toHaveText("£10,000");
    await expect(page.getByTestId("credA")).toHaveText("£30,000");
    await expect(page.getByTestId("qc-owner")).toHaveText("→ credited to Owner A");
    await expect(page.getByTestId("wfOwnerA")).toHaveText("− £30,000");
    // Nothing is lost: it moves from cost into Owner A's share.
    await expect(page.getByTestId("totalDist")).toHaveText("£390,000");
  });
});

test.describe("margin — the PDF report", () => {
  test("downloads from bundled dependencies, with nothing fetched off-site", async ({
    page,
    baseURL,
  }) => {
    const offSite: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith(baseURL!) && !url.startsWith("data:") && !url.startsWith("blob:")) {
        offSite.push(url);
      }
    });

    await signInAs(page, "margin.only@example.test");
    await seed(page, EXAMPLE_TWO);
    await gotoMargin(page);
    await page.getByTestId("sc-name").fill("Q1 2026");

    const download = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("sc-pdf").click(),
    ]).then(([d]) => d);

    expect(download.suggestedFilename()).toBe("Q1_2026_margin_split.pdf");
    await expect(page.getByTestId("sc-stamp")).toContainText("PDF downloaded");

    // jsPDF and jspdf-autotable are bundled; the live page loads both from
    // cdnjs. Nothing here may reach a third party.
    expect(offSite, "the page must not fetch anything off-site").toEqual([]);
  });

  test("a scenario can be saved, reloaded and deleted", async ({ page }) => {
    await signInAs(page, "margin.only@example.test");
    await gotoMargin(page);

    await page.getByTestId("revenue").fill("777000");
    await page.getByTestId("sc-name").fill("Best case");
    await page.getByTestId("sc-save").click();
    await expect(page.getByTestId("sc-stamp")).toContainText("Saved “Best case”");

    await page.getByTestId("revenue").fill("1000");
    await expect(page.getByTestId("kRev")).toHaveText("£1,000");

    await page.getByTestId("sc-load").click();
    await expect(page.getByTestId("revenue")).toHaveValue("777000");
    await expect(page.getByTestId("sc-stamp")).toContainText("Loaded “Best case”");

    await page.getByTestId("sc-delete").click();
    await expect(page.getByTestId("sc-stamp")).toHaveText("Scenario deleted.");
    await expect(page.getByTestId("sc-select")).toHaveText("— none saved —");
  });
});

/**
 * Named widths, because the working rules say layout criteria must name them.
 * Seven columns of staff will not fit a phone; the staff block scrolls inside
 * itself so the page itself never does.
 */
const WIDTHS = [
  // `staffFits` — whether all seven staff columns are on screen without
  // scrolling the block. A phone cannot manage it; a laptop must, or the Qtr
  // cost column is hidden behind a scrollbar nobody looks for.
  { name: "390-phone", width: 390, height: 844, staffFits: false },
  { name: "768-tablet", width: 768, height: 1024, staffFits: true },
  { name: "1024-laptop", width: 1024, height: 768, staffFits: true },
  { name: "1440-desktop", width: 1440, height: 900, staffFits: true },
];

test.describe("margin — layout at every width", () => {
  for (const w of WIDTHS) {
    test(`the calculator fits ${w.name}`, async ({ page }, testInfo) => {
      await signInAs(page, "margin.only@example.test");
      await seed(page, EXAMPLE_TWO);
      await page.setViewportSize({ width: w.width, height: w.height });
      await gotoMargin(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll horizontally").toBeLessThanOrEqual(0);

      const staffOverflow = await page
        .locator(".staff-scroll")
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      if (w.staffFits) {
        expect(staffOverflow, "every staff column should be on screen").toBeLessThanOrEqual(0);
        await expect(page.getByTestId("qc-cost").first()).toBeInViewport();
      } else {
        expect(staffOverflow, "the staff block is what scrolls, not the page").toBeGreaterThan(0);
      }

      await testInfo.attach(`margin-${w.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
});

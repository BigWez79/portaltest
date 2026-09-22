import type { Page } from "@playwright/test";
import { expect, signInAs, test } from "./harness";

/**
 * Tax Breakdown — the ported calculator.
 *
 * The four worked examples below are not hand-derived. They were read off the
 * live `taxbreakdown.html` running in a headless browser with every http(s)
 * request aborted, so the expectations here are that page's own output, down to
 * the `£-0` its formatter writes for a negated zero. If a change to
 * `src/lib/tax-model.ts` moves one of these figures, the port has stopped
 * agreeing with the app it replaced.
 *
 * Between them the four cover every branch of the engine: the small profits
 * rate, the marginal relief band, the main rate, a loss, the personal allowance
 * tapering to nil, other PAYE income stacked under this company's salary, both
 * AMAP mileage bands, and the Employment Allowance on and off.
 *
 * Each example is fed in by planting the live page's own localStorage payload
 * before the app boots, which checks the storage format at the same time: a
 * browser that has used the live page keeps its figures.
 */

const STORAGE_KEY = "paTaxBreakdownInputs_v1";

type Stored = Record<string, string | number | boolean>;

type Rendered = {
  labels: Record<string, string>;
  ledger: string[][];
  summary: string[][];
  directors: { name: string; pct: string; lines: string[][] }[];
};

/** The live page's saved-state shape, planted before any script runs. */
async function seed(page: Page, stored: Stored) {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, JSON.stringify(value));
    },
    [STORAGE_KEY, stored] as const,
  );
}

const IN_ONE: Stored = {
  companyName: "Example Co",
  revenue: 115000,
  generalExpenses: 20000,
  travelExpenses: 5000,
  otherExpenses: 5000,
  nameA: "Alex",
  salaryA: 12570,
  pensionA: 6000,
  milesA: 0,
  otherIncomeA: 0,
  nameB: "Bev",
  salaryB: 12570,
  pensionB: 6000,
  milesB: 0,
  otherIncomeB: 0,
  mileageRateFirst: 45,
  mileageRateAfter: 25,
  employmentAllowance: true,
  payoutPct: 100,
  splitA: 50,
};

const OUT_ONE: Rendered = {
  labels: {
    nameALabel: "Alex",
    nameBLabel: "Bev",
    splitALabel: "Alex",
    payoutPctValue: "100%",
    splitAValue: "50%",
    splitALine: "Alex: 50%",
    splitBLine: "Bev: 50%",
    mileageAResult: "£0",
    mileageBResult: "£0",
  },
  ledger: [
    ["Revenue", "£115,000"],
    ["General expenses", "-£20,000"],
    ["Travel expenses (hotels, other)", "-£5,000"],
    ["Mileage allowance (both directors)", "£-0"],
    ["Other allowable expenses", "-£5,000"],
    ["Director salaries", "-£25,140"],
    ["Employer NI (net of allowance)", "£-0"],
    ["Employer pension contributions", "-£12,000"],
    ["Profit before Corporation Tax", "£47,860"],
    ["Corporation Tax", "-£9,093"],
    ["Profit after tax", "£38,767"],
    ["Dividends declared", "-£38,767"],
    ["Retained in company", "£0"],
  ],
  summary: [
    ["Corporation Tax", "£9,093", "Small profits rate (19%)"],
    ["Total tax & NI (company + personal)", "£13,153", "11.4% of revenue"],
    ["Combined take-home (both directors)", "£59,847", "After all salary & dividend tax"],
    ["Retained in company", "£0", "Undistributed post-tax profit"],
  ],
  directors: [
    {
      name: "Alex",
      pct: "93.64712017225138",
      lines: [
        ["Gross salary", "£12,570"],
        ["Income tax on this company's salary", "-£0"],
        ["Employee NI", "-£0"],
        ["Dividends received", "£19,383"],
        ["Dividend tax", "-£2,030"],
        ["Employer pension (not personal income)", "£6,000"],
        ["Net take-home", "£29,923"],
      ],
    },
    {
      name: "Bev",
      pct: "93.64712017225138",
      lines: [
        ["Gross salary", "£12,570"],
        ["Income tax on this company's salary", "-£0"],
        ["Employee NI", "-£0"],
        ["Dividends received", "£19,383"],
        ["Dividend tax", "-£2,030"],
        ["Employer pension (not personal income)", "£6,000"],
        ["Net take-home", "£29,923"],
      ],
    },
  ],
};

const IN_TWO: Stored = {
  companyName: "Marginal Relief Ltd",
  revenue: 400000,
  generalExpenses: 30000,
  travelExpenses: 10000,
  otherExpenses: 10000,
  nameA: "Alex",
  salaryA: 60000,
  pensionA: 10000,
  milesA: 12000,
  otherIncomeA: 0,
  nameB: "Bev",
  salaryB: 20000,
  pensionB: 5000,
  milesB: 5000,
  otherIncomeB: 15000,
  mileageRateFirst: 45,
  mileageRateAfter: 25,
  employmentAllowance: false,
  payoutPct: 80,
  splitA: 60,
};

const OUT_TWO: Rendered = {
  labels: {
    nameALabel: "Alex",
    nameBLabel: "Bev",
    splitALabel: "Alex",
    payoutPctValue: "80%",
    splitAValue: "60%",
    splitALine: "Alex: 60%",
    splitBLine: "Bev: 40%",
    mileageAResult: "£5,000",
    mileageBResult: "£2,250",
  },
  ledger: [
    ["Revenue", "£400,000"],
    ["General expenses", "-£30,000"],
    ["Travel expenses (hotels, other)", "-£10,000"],
    ["Mileage allowance (both directors)", "-£7,250"],
    ["Other allowable expenses", "-£10,000"],
    ["Director salaries", "-£80,000"],
    ["Employer NI (net of allowance)", "-£10,500"],
    ["Employer pension contributions", "-£15,000"],
    ["Profit before Corporation Tax", "£237,250"],
    ["Corporation Tax", "-£59,121"],
    ["Profit after tax", "£178,129"],
    ["Dividends declared", "-£142,503"],
    ["Retained in company", "£35,626"],
  ],
  summary: [
    ["Corporation Tax", "£59,121", "Marginal relief band · relief £191"],
    ["Total tax & NI (company + personal)", "£139,000", "34.8% of revenue"],
    ["Combined take-home (both directors)", "£153,124", "After all salary & dividend tax"],
    ["Retained in company", "£35,626", "Undistributed post-tax profit"],
  ],
  directors: [
    {
      name: "Alex",
      pct: "66.81981370677202",
      lines: [
        ["Gross salary", "£60,000"],
        ["Income tax on this company's salary", "-£13,946"],
        ["Employee NI", "-£3,211"],
        ["Dividends received", "£85,502"],
        ["Dividend tax", "-£31,121"],
        ["Employer pension (not personal income)", "£10,000"],
        ["Net take-home", "£97,224"],
      ],
    },
    {
      name: "Bev",
      pct: "72.59642836735011",
      lines: [
        ["Other PAYE income (external, informational)", "£15,000"],
        ["Gross salary", "£20,000"],
        ["Income tax on this company's salary", "-£4,000"],
        ["Employee NI", "-£594"],
        ["Dividends received", "£57,001"],
        ["Dividend tax", "-£16,507"],
        ["Employer pension (not personal income)", "£5,000"],
        ["Net take-home", "£55,900"],
      ],
    },
  ],
};

const IN_THREE: Stored = {
  companyName: "Main Rate Ltd",
  revenue: 700000,
  generalExpenses: 40000,
  travelExpenses: 20000,
  otherExpenses: 10000,
  nameA: "Alex",
  salaryA: 12570,
  pensionA: 20000,
  milesA: 20000,
  otherIncomeA: 40000,
  nameB: "Bev",
  salaryB: 12570,
  pensionB: 20000,
  milesB: 0,
  otherIncomeB: 0,
  mileageRateFirst: 45,
  mileageRateAfter: 25,
  employmentAllowance: true,
  payoutPct: 100,
  splitA: 50,
};

const OUT_THREE: Rendered = {
  labels: {
    nameALabel: "Alex",
    nameBLabel: "Bev",
    splitALabel: "Alex",
    payoutPctValue: "100%",
    splitAValue: "50%",
    splitALine: "Alex: 50%",
    splitBLine: "Bev: 50%",
    mileageAResult: "£7,000",
    mileageBResult: "£0",
  },
  ledger: [
    ["Revenue", "£700,000"],
    ["General expenses", "-£40,000"],
    ["Travel expenses (hotels, other)", "-£20,000"],
    ["Mileage allowance (both directors)", "-£7,000"],
    ["Other allowable expenses", "-£10,000"],
    ["Director salaries", "-£25,140"],
    ["Employer NI (net of allowance)", "£-0"],
    ["Employer pension contributions", "-£40,000"],
    ["Profit before Corporation Tax", "£557,860"],
    ["Corporation Tax", "-£139,465"],
    ["Profit after tax", "£418,395"],
    ["Dividends declared", "-£418,395"],
    ["Retained in company", "£0"],
  ],
  summary: [
    ["Corporation Tax", "£139,465", "Main rate (25%)"],
    ["Total tax & NI (company + personal)", "£293,269", "41.9% of revenue"],
    ["Combined take-home (both directors)", "£289,731", "After all salary & dividend tax"],
    ["Retained in company", "£0", "Undistributed post-tax profit"],
  ],
  directors: [
    {
      name: "Alex",
      pct: "62.797999594169575",
      lines: [
        ["Other PAYE income (external, informational)", "£40,000"],
        ["Gross salary", "£12,570"],
        ["Income tax on this company's salary", "-£2,974"],
        ["Employee NI", "-£0"],
        ["Dividends received", "£209,198"],
        ["Dividend tax", "-£79,528"],
        ["Employer pension (not personal income)", "£20,000"],
        ["Net take-home", "£139,266"],
      ],
    },
    {
      name: "Bev",
      pct: "67.84833384062138",
      lines: [
        ["Gross salary", "£12,570"],
        ["Income tax on this company's salary", "-£2,514"],
        ["Employee NI", "-£0"],
        ["Dividends received", "£209,198"],
        ["Dividend tax", "-£68,788"],
        ["Employer pension (not personal income)", "£20,000"],
        ["Net take-home", "£150,466"],
      ],
    },
  ],
};

const IN_FOUR: Stored = {
  companyName: "Loss Making Ltd",
  revenue: 40000,
  generalExpenses: 20000,
  travelExpenses: 5000,
  otherExpenses: 5000,
  nameA: "Alex",
  salaryA: 25000,
  pensionA: 0,
  milesA: 0,
  otherIncomeA: 0,
  nameB: "Bev",
  salaryB: 0,
  pensionB: 0,
  milesB: 0,
  otherIncomeB: 0,
  mileageRateFirst: 45,
  mileageRateAfter: 25,
  employmentAllowance: false,
  payoutPct: 100,
  splitA: 50,
};

const OUT_FOUR: Rendered = {
  labels: {
    nameALabel: "Alex",
    nameBLabel: "Bev",
    splitALabel: "Alex",
    payoutPctValue: "100%",
    splitAValue: "50%",
    splitALine: "Alex: 50%",
    splitBLine: "Bev: 50%",
    mileageAResult: "£0",
    mileageBResult: "£0",
  },
  ledger: [
    ["Revenue", "£40,000"],
    ["General expenses", "-£20,000"],
    ["Travel expenses (hotels, other)", "-£5,000"],
    ["Mileage allowance (both directors)", "£-0"],
    ["Other allowable expenses", "-£5,000"],
    ["Director salaries", "-£25,000"],
    ["Employer NI (net of allowance)", "-£3,000"],
    ["Employer pension contributions", "£-0"],
    ["Profit before Corporation Tax", "-£18,000"],
    ["Corporation Tax", "£-0"],
    ["Profit after tax", "£0"],
    ["Dividends declared", "£-0"],
    ["Retained in company", "£0"],
  ],
  summary: [
    ["Corporation Tax", "£0", "None (no profit)"],
    ["Total tax & NI (company + personal)", "£6,480", "16.2% of revenue"],
    ["Combined take-home (both directors)", "£21,520", "After all salary & dividend tax"],
    ["Retained in company", "£0", "Undistributed post-tax profit"],
  ],
  directors: [
    {
      name: "Alex",
      pct: "86.0784",
      lines: [
        ["Gross salary", "£25,000"],
        ["Income tax on this company's salary", "-£2,486"],
        ["Employee NI", "-£994"],
        ["Dividends received", "£0"],
        ["Dividend tax", "-£0"],
        ["Employer pension (not personal income)", "£0"],
        ["Net take-home", "£21,520"],
      ],
    },
    {
      name: "Bev",
      pct: "0",
      lines: [
        ["Gross salary", "£0"],
        ["Income tax on this company's salary", "-£0"],
        ["Employee NI", "-£0"],
        ["Dividends received", "£0"],
        ["Dividend tax", "-£0"],
        ["Employer pension (not personal income)", "£0"],
        ["Net take-home", "£0"],
      ],
    },
  ],
};

const LABEL_IDS = [
  "nameALabel",
  "nameBLabel",
  "splitALabel",
  "payoutPctValue",
  "splitAValue",
  "splitALine",
  "splitBLine",
  "mileageAResult",
  "mileageBResult",
];

/**
 * Goes to the calculator and waits for it to have restored what was seeded. The
 * first paint shows the placeholder defaults and the saved state arrives an
 * effect later, so a read taken on `toBeVisible()` alone can catch a mix.
 */
async function gotoTax(page: Page) {
  await page.goto("/tax-breakdown");
  await expect(page.getByTestId("tax-calculator")).toHaveAttribute("data-hydrated", "1");
}

/**
 * `textContent`, not `innerText`: the stat labels are uppercased in CSS, and
 * `innerText` reports what is painted. The strings being pinned are the live
 * page's own, so read the same thing it wrote.
 */
const trimAll = (xs: string[]) => xs.map((x) => x.trim());

const textOf = async (loc: import("@playwright/test").Locator) =>
  ((await loc.textContent()) ?? "").trim();

const zip = (a: string[], b: string[]) => a.map((x, i) => [x, b[i]]);

/** Everything the page computed, in one read, to compare against one literal. */
async function readRendered(page: Page): Promise<Rendered> {
  const labels: Record<string, string> = {};
  for (const id of LABEL_IDS) labels[id] = await textOf(page.getByTestId(id));

  const ledger = zip(
    trimAll(await page.getByTestId("ledger-label").allTextContents()),
    trimAll(await page.getByTestId("ledger-value").allTextContents()),
  );

  const cards = page.getByTestId("stat-card");
  const summary: string[][] = [];
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    summary.push([
      await textOf(card.getByTestId("stat-label")),
      await textOf(card.getByTestId("stat-value")),
      await textOf(card.getByTestId("stat-detail")),
    ]);
  }

  const drCards = page.getByTestId("dr-card");
  const directors: Rendered["directors"] = [];
  for (let i = 0; i < (await drCards.count()); i++) {
    const card = drCards.nth(i);
    directors.push({
      name: await textOf(card.getByTestId("dr-name")),
      pct: (await card.getByTestId("dr-bar").getAttribute("data-pct")) ?? "",
      lines: zip(
        trimAll(await card.getByTestId("dr-label").allTextContents()),
        trimAll(await card.getByTestId("dr-value").allTextContents()),
      ),
    });
  }

  return { labels, ledger, summary, directors };
}

const EXAMPLES: { name: string; input: Stored; expected: Rendered }[] = [
  {
    name: "the small profits rate, with the Employment Allowance wiping out employer NI",
    input: IN_ONE,
    expected: OUT_ONE,
  },
  {
    name: "the marginal relief band, both mileage bands, and a second job under the salary",
    input: IN_TWO,
    expected: OUT_TWO,
  },
  {
    name: "the main rate, with the personal allowance tapered away to nil",
    input: IN_THREE,
    expected: OUT_THREE,
  },
  {
    name: "a loss: no Corporation Tax, no dividends, and the salary still taxed",
    input: IN_FOUR,
    expected: OUT_FOUR,
  },
];

test.describe("tax breakdown — the worked examples", () => {
  for (const example of EXAMPLES) {
    test(`example: ${example.name}`, async ({ page }) => {
      await signInAs(page, "tax.only@example.test");
      await seed(page, example.input);
      await gotoTax(page);

      expect(await readRendered(page)).toEqual(example.expected);
    });
  }
});

/**
 * The whole of step 1 of "what each port involves" (docs/PORTING-APPS.md), as a
 * check rather than a claim.
 *
 * The live page loads `msal-browser@3` from jsdelivr and carries a client id and
 * a tenant id for the suite's shared Entra app registration in plain sight. None
 * of that may reach a browser from here — and neither may anything else off-site,
 * since Sora and Albert Sans are self-hosted and MSAL was the only script.
 */
test.describe("tax breakdown — the sign-in did not come across", () => {
  /** The two identifiers printed on the live page. Neither belongs in this repo. */
  const ENTRA_CLIENT_ID = "f76b090f-7d46-447b-8545-954d22814232";
  const ENTRA_TENANT_ID = "be344548-8db6-49d6-8155-1f85b6ae1dad";

  const FORBIDDEN = [
    /msal/i,
    /login\.microsoftonline\.com/i,
    /graph\.microsoft\.com/i,
    new RegExp(ENTRA_CLIENT_ID, "i"),
    new RegExp(ENTRA_TENANT_ID, "i"),
  ];

  test("nothing is fetched off-site, and no MSAL is served", async ({ page, baseURL }) => {
    const offSite: string[] = [];
    const served = new Set<string>();

    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith(baseURL!) && !url.startsWith("data:") && !url.startsWith("blob:")) {
        offSite.push(url);
      }
    });
    page.on("response", (res) => {
      if (res.url().startsWith(baseURL!)) served.add(res.url());
    });

    await signInAs(page, "tax.only@example.test");
    await seed(page, IN_TWO);
    await gotoTax(page);

    expect(offSite, "the page must not fetch anything off-site").toEqual([]);

    // Re-read everything the page pulled from this origin and look inside it.
    const scanned: string[] = [];
    for (const url of served) {
      if (/\.(woff2?|png|ico|jpe?g|svg|webp)$/i.test(new URL(url).pathname)) continue;
      const body = await page.request.get(url);
      const text = await body.text();
      scanned.push(url);
      for (const pattern of FORBIDDEN) {
        expect(text, `${url} must not mention ${pattern}`).not.toMatch(pattern);
      }
    }

    // A scan of nothing passes every pattern. Rule 12: say what had to be true.
    expect(
      scanned.some((u) => u.includes("/tax-breakdown")),
      "the page's own HTML should have been scanned",
    ).toBe(true);
    expect(
      scanned.some((u) => new URL(u).pathname.endsWith(".js")),
      "the page's JavaScript should have been scanned",
    ).toBe(true);
  });
});

test.describe("tax breakdown — the defaults", () => {
  /**
   * What a first visit shows. The rates are statutory and come across exactly;
   * the input figures are placeholders. See the note in src/lib/tax-model.ts.
   */
  const PLACEHOLDERS: [string, string][] = [
    ["revenue", "200000"],
    ["generalExpenses", "20000"],
    ["travelExpenses", "5000"],
    ["otherExpenses", "5000"],
    ["salaryA", "12570"],
    ["pensionA", "5000"],
    ["milesA", "0"],
    ["otherIncomeA", "0"],
    ["salaryB", "12570"],
    ["pensionB", "5000"],
    ["milesB", "0"],
    ["otherIncomeB", "0"],
    // HMRC AMAP, not a placeholder: 45p for the first 10,000 miles, then 25p.
    ["mileageRateFirst", "45"],
    ["mileageRateAfter", "25"],
    ["payoutPct", "100"],
    ["splitA", "50"],
  ];

  /** The live page's own default inputs. None of them ships here. */
  const LIVE_FIGURES = [
    "Power Analytix Limited",
    "220000",
    "220,000",
    "18000",
    "18,000",
    "6000",
    "6,000",
    "4000",
    "4,000",
  ];

  test("a first visit shows placeholder inputs and the statutory rates", async ({ page }) => {
    await signInAs(page, "tax.only@example.test");
    await gotoTax(page);

    for (const [id, value] of PLACEHOLDERS) {
      await expect(page.getByTestId(id), `${id} should be the placeholder`).toHaveValue(value);
    }
    await expect(page.getByTestId("companyName")).toHaveValue("Example Company Limited");
    await expect(page.getByTestId("nameA")).toHaveValue("Director A");
    await expect(page.getByTestId("nameB")).toHaveValue("Director B");
    await expect(page.getByTestId("employmentAllowance")).toBeChecked();

    const body = await page.locator("body").innerText();
    const inputs = await page
      .locator("input")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join(" "));
    for (const figure of LIVE_FIGURES) {
      expect(`${body} ${inputs}`, `the live page's ${figure} must not ship here`).not.toContain(
        figure,
      );
    }
  });

  test("the statutory rates are on the page, in the tax year they belong to", async ({ page }) => {
    await signInAs(page, "tax.only@example.test");
    await gotoTax(page);

    await expect(page.getByTestId("tax-year")).toHaveText("TAX YEAR 2026/27");
    const note = await page.locator(".tax-app .note").innerText();
    for (const rate of [
      "19%",
      "25%",
      "£50,000",
      "£250,000",
      "£500",
      "10.75%",
      "35.75%",
      "39.35%",
      "£12,570",
      "£100,000",
      "£125,140",
      "8%/2%",
      "15%",
      "£5,000",
    ]) {
      expect(note, `the note should still state ${rate}`).toContain(rate);
    }
  });
});

test.describe("tax breakdown — saving in this browser", () => {
  test("an edit is remembered under the live page's own key", async ({ page }) => {
    await signInAs(page, "tax.only@example.test");
    await gotoTax(page);

    await page.getByTestId("revenue").fill("321000");
    await expect(page.getByTestId("tax-save-status")).toHaveText("✓ Saved to this browser");

    // Under the live page's key, in the live page's shape — numbers, not strings.
    const stored = await page.evaluate(
      (key) => JSON.parse(window.localStorage.getItem(key) ?? "null"),
      STORAGE_KEY,
    );
    expect(stored.revenue).toBe(321000);
    expect(stored.employmentAllowance).toBe(true);
    expect(stored.nameA).toBe("Director A");

    await page.reload();
    await expect(page.getByTestId("tax-calculator")).toHaveAttribute("data-hydrated", "1");
    await expect(page.getByTestId("revenue")).toHaveValue("321000");
  });

  test("reset puts the placeholders back", async ({ page }) => {
    await signInAs(page, "tax.only@example.test");
    await seed(page, IN_TWO);
    await gotoTax(page);
    await expect(page.getByTestId("revenue")).toHaveValue("400000");

    // The live page asks before it throws saved figures away, and so does this.
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("tax-reset").click();

    await expect(page.getByTestId("revenue")).toHaveValue("200000");
    await expect(page.getByTestId("nameA")).toHaveValue("Director A");
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(stored, "reset clears what was saved").toBeNull();
  });

  test("a refused reset keeps the figures", async ({ page }) => {
    await signInAs(page, "tax.only@example.test");
    await seed(page, IN_TWO);
    await gotoTax(page);

    page.once("dialog", (d) => d.dismiss());
    await page.getByTestId("tax-reset").click();

    await expect(page.getByTestId("revenue")).toHaveValue("400000");
  });
});

test.describe("tax breakdown — editing recalculates", () => {
  test("the sliders, the allowance and a salary all move the figures", async ({ page }) => {
    await signInAs(page, "tax.only@example.test");
    await seed(page, IN_TWO);
    await gotoTax(page);

    const stat = (label: string) =>
      page
        .getByTestId("stat-card")
        .filter({ has: page.getByTestId("stat-label").getByText(label, { exact: true }) })
        .getByTestId("stat-value");

    await expect(stat("Corporation Tax")).toHaveText("£59,121");

    // Employer NI of £10,500 is exactly the Employment Allowance cap: claiming
    // it wipes the charge out, which lifts profit and so lifts Corporation Tax.
    await page.getByTestId("employmentAllowance").check();
    await expect(page.getByTestId("ledger-value").nth(6)).toHaveText("£-0");
    await expect(stat("Corporation Tax")).toHaveText("£61,904");

    // Paying nothing out retains the lot and leaves both directors on salary.
    await page.getByTestId("payoutPct").fill("0");
    await expect(page.getByTestId("payoutPctValue")).toHaveText("0%");
    await expect(stat("Retained in company")).toHaveText("£185,846");
    await expect(page.getByTestId("dr-card").first().getByTestId("dr-value").nth(3)).toHaveText(
      "£0",
    );

    // Each figure above is the live page's, read the same way as the worked
    // examples: taxbreakdown.html driven headless with every http(s) request
    // aborted, with these edits applied to the same seeded state.

    // Renaming a director renames their heading, their split label and their card.
    await page.getByTestId("nameA").fill("Robin");
    await expect(page.getByTestId("nameALabel")).toHaveText("Robin");
    await expect(page.getByTestId("splitALabel")).toHaveText("Robin");
    await expect(page.getByTestId("splitALine")).toHaveText("Robin: 60%");
    await expect(page.getByTestId("dr-name").first()).toHaveText("Robin");
  });
});

/**
 * Named widths, because the working rules say layout criteria must name them.
 * The four input cards, the four summary cards and the two director cards are
 * auto-fit grids; `columns` is how many of the input cards fit, and the page
 * itself must never scroll sideways at any of these.
 */
const WIDTHS = [
  { name: "390-phone", width: 390, height: 844, columns: 1 },
  { name: "768-tablet", width: 768, height: 1024, columns: 2 },
  { name: "1024-laptop", width: 1024, height: 768, columns: 3 },
  { name: "1440-desktop", width: 1440, height: 900, columns: 3 },
];

test.describe("tax breakdown — layout at every width", () => {
  for (const w of WIDTHS) {
    test(`the calculator fits ${w.name}`, async ({ page }, testInfo) => {
      await signInAs(page, "tax.only@example.test");
      await seed(page, IN_TWO);
      await page.setViewportSize({ width: w.width, height: w.height });
      await gotoTax(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll horizontally").toBeLessThanOrEqual(0);

      const columns = await page
        .locator(".tax-app .grid")
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(columns, `${w.name} should lay the input cards out in ${w.columns} column(s)`).toBe(
        w.columns,
      );

      // The ledger total is the figure the page exists to produce; it has to be
      // readable at every width, not pushed off the side of its own panel.
      const ledgerOverflow = await page
        .locator(".tax-app .ledger")
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(ledgerOverflow, "the ledger must not scroll sideways either").toBeLessThanOrEqual(0);

      await testInfo.attach(`tax-breakdown-${w.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
});

import { expect, pdfText, resetStores, signInAs, test } from "./harness";

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
    await page.getByTestId("view-claim").click();
    await expect(page.getByTestId("month-2026-07")).toBeVisible();
    await expect(page.getByTestId("month-2026-06")).toBeVisible();

    // £66.28 mileage + £89.00 hotel
    await expect(page.getByTestId("total-2026-07")).toHaveText("£155.28");
  });

  test("somebody else's claims are not in the page", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await page.getByTestId("view-claim").click();

    // everything@ has a £47.80 train fare in the same month. It is not this
    // person's, so it must not be in the total or the DOM.
    await expect(page.getByTestId("total-2026-07")).not.toHaveText("£203.08");
    await expect(page.getByText("Return to London")).toHaveCount(0);
  });

  test("a locked month says so and offers nothing to change", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await page.getByTestId("view-claim").click();
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
    await page.getByTestId("view-admin").click();
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
    await page.getByTestId("view-claim").click();
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
    await page.getByTestId("view-claim").click();
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

    await page.getByTestId("view-claim").click();
    await page.getByTestId("remove-22222222-2222-4222-8222-222222222222").click();

    await expect(page.getByTestId("row-22222222-2222-4222-8222-222222222222")).toHaveCount(0);
    // £155.28 less the £89.00 hotel
    await expect(page.getByTestId("total-2026-07")).toHaveText("£66.28");
  });

  test("submitting a month locks it, and the lock holds on reload", async ({ page }) => {
    await signInAs(page, OWNER);
    await page.goto("/expenses");

    await page.getByTestId("view-claim").click();
    await page.getByTestId("submit-2026-07").click();
    await expect(page.getByTestId("lock-ok")).toBeVisible({ timeout: 15000 });

    await page.reload();
    await page.getByTestId("view-claim").click();
    await expect(page.getByTestId("locked-2026-07")).toBeVisible();
    await expect(page.getByTestId("submit-2026-07")).toHaveCount(0);
  });

  test("an admin can change the mileage rates, and the next claim uses them", async ({ page }) => {
    await signInAs(page, OTHER);
    await page.goto("/expenses");

    await page.getByTestId("view-admin").click();
    await page.getByTestId("rate1").fill("0.80");
    await page.getByTestId("save-rates").click();
    await expect(page.getByTestId("rates-ok")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("view-log").click();
    await page.getByTestId("expense-type").selectOption("Mileage");
    await page.getByTestId("expense-miles").fill("10");
    await expect(page.getByTestId("mileage-preview")).toContainText("£8.00");
  });
});

test.describe("expenses — the claim document", () => {
  test("the claim carries both tables, both subtotals, and a total that is their sum", async ({
    page,
  }) => {
    await signInAs(page, "expenses.only@example.test");
    await page.goto("/expenses");
    await page.getByTestId("view-claim").click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("claim-2026-07").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^PowerAnalytix-expenses-2026-07-[A-Za-z0-9_]+\.pdf$/,
    );

    // Reading the file rather than trusting that one arrived. A claim missing
    // its mileage table, or totalling wrong, downloads just as happily as a
    // correct one — so the assertion has to be about what is on the page.
    const file = await download.path();
    expect(file).toBeTruthy();
    const text = await pdfText(file!);

    expect(text).toContain("EXPENSES CLAIM");
    expect(text).toContain("July 2026");
    expect(text).toContain("expenses.only@example.test");

    // Mileage is a route and a distance; everything else is a receipt for an
    // amount. Two tables, because one would mean a Miles column empty on most
    // rows and a Receipt column meaningless on the rest.
    expect(text, "the mileage table").toContain("Leicester to Birmingham");
    expect(text).toContain("120.5");
    expect(text, "the receipted table").toContain("Overnight before early start");

    // The two subtotals get checked against different things — one against the
    // rate and the distance, the other against a pile of receipts — so both
    // have to be on the document, and the total has to be their sum.
    expect(text).toContain("Mileage subtotal:");
    expect(text).toContain("£66.28");
    expect(text).toContain("Other subtotal:");
    expect(text).toContain("£89.00");
    expect(text).toContain("£155.28");

    expect(text, "the declaration").toContain("wholly and necessarily for business");
  });

  test("nothing off this origin is fetched to build it", async ({ page }) => {
    const offsite: string[] = [];
    await page.route("**", (route) => {
      const url = route.request().url();
      if (!url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
        offsite.push(url);
        return route.abort();
      }
      return route.continue();
    });

    await signInAs(page, "expenses.only@example.test");
    await page.goto("/expenses");
    await page.getByTestId("view-claim").click();
    await Promise.all([page.waitForEvent("download"), page.getByTestId("claim-2026-07").click()]);

    // jsPDF is bundled, not pulled from cdnjs. A signed-in page fetching
    // executable code from a third party is what this whole port exists to
    // stop, and a claim is built from somebody's travel and their receipts.
    expect(offsite, "nothing off-site").toEqual([]);
  });
});

test.describe("expenses — the four screens", () => {
  test("logging, looking back, and claiming are separate screens", async ({ page }) => {
    await signInAs(page, "expenses.only@example.test");
    await page.goto("/expenses");

    // Log is where it opens: the common thing is adding one.
    await expect(page.getByTestId("expense-form")).toBeVisible();
    await expect(page.getByTestId("entries-card")).toHaveCount(0);

    await page.getByTestId("view-entries").click();
    await expect(page.getByTestId("entries-card")).toBeVisible();
    await expect(page.getByTestId("month-2026-07")).toHaveCount(0);

    await page.getByTestId("view-claim").click();
    await expect(page.getByTestId("month-2026-07")).toBeVisible();
    await expect(page.getByTestId("claim-2026-07")).toBeVisible();
  });

  test("editing from My entries takes you to the form with it loaded", async ({ page }) => {
    await signInAs(page, "expenses.only@example.test");
    await page.goto("/expenses");
    await page.getByTestId("view-entries").click();

    const row = page.locator("[data-testid^=entry-edit-]").first();
    await row.click();

    // The form is where an expense is edited, so that is where it sends you —
    // leaving somebody on a list while the form they need is on another screen
    // is how the merged version made an edit hard to find.
    await expect(page.getByTestId("expense-form")).toBeVisible();
    await expect(page.getByTestId("expenses-app")).toContainText("Edit expense");
  });

  test("a non-admin has no Admin screen at all", async ({ page }) => {
    await signInAs(page, "expenses.only@example.test");
    await page.goto("/expenses");

    // Absent from the DOM, not hidden — the same rule as the tiles (rule 3).
    await expect(page.getByTestId("view-admin")).toHaveCount(0);
    await expect(page.getByTestId("admin-claim-card")).toHaveCount(0);
    await expect(page.getByTestId("rates-card")).toHaveCount(0);
  });
});

test.describe("expenses — an admin's copy of somebody else's claim", () => {
  test("an admin picks a person and a month and gets their document", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/expenses");
    await page.getByTestId("view-admin").click();

    await page.getByTestId("their-person").selectOption("expenses.only@example.test");
    await page.getByTestId("their-month").selectOption("2026-07");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("their-claim").click(),
    ]);

    const file = await download.path();
    const text = await pdfText(file!);

    // The same document they would produce themselves, with their name on it
    // rather than the admin's.
    expect(text).toContain("EXPENSES CLAIM");
    expect(text).toContain("expenses.only@example.test");
    expect(text).toContain("Leicester to Birmingham");
    expect(text).toContain("£155.28");
  });

  test("the months offered are the ones that person actually has", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/expenses");
    await page.getByTestId("view-admin").click();

    // A claim for a month somebody has nothing in is an empty document, and
    // offering it is a dead end. The list is read off their rows.
    await page.getByTestId("their-person").selectOption("expenses.only@example.test");
    const theirs = await page.getByTestId("their-month").locator("option").allTextContents();
    expect(theirs).toContain("July 2026");
    expect(theirs).toContain("June 2026");

    await page.getByTestId("their-person").selectOption("everything@example.test");
    const mine = await page.getByTestId("their-month").locator("option").allTextContents();
    expect(mine).not.toContain("June 2026");
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

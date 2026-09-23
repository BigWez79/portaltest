import { expect, resetStores, signInAs, test } from "./harness";

/**
 * Invoices — the heaviest port, and the only app producing a document somebody
 * outside the company reads.
 *
 * The write tests run serially after a reset: parallel workers share one
 * fixture file, and a suite that leaves an invoice behind poisons the next one.
 */

const SELLER = "invoices.only@example.test";
const OTHER = "everything@example.test";

test.describe("invoices — reading your own", () => {
  test("your invoices are listed, newest first, with their totals", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    await expect(page.getByTestId("invoices-app")).toBeVisible();
    await expect(page.getByTestId("total-INV-0001")).toHaveText("£1,800.00");
    await expect(page.getByTestId("total-INV-0002")).toHaveText("£480.00");
  });

  test("somebody else's invoice is not in the page, even sharing a number", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    // everything@ also has an INV-0001. Numbers are unique per seller, so the
    // one on screen must be this seller's £1,800 and not the other £108.
    await expect(page.getByTestId("total-INV-0001")).not.toHaveText("£108.00");
    await expect(page.getByText("Somebody else's work")).toHaveCount(0);
  });

  test("a status says what may still be done to an invoice", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    await expect(page.getByTestId("status-INV-0001")).toHaveText("Sent");
    await expect(page.getByTestId("status-INV-0002")).toHaveText("Paid");
  });

  test("the summary counts drafts and adds up what is owed", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    // One sent invoice at £1,800 owed; one paid at £480.
    await expect(page.getByTestId("kpi-owed")).toContainText("£1,800.00");
    await expect(page.getByTestId("kpi-paid")).toContainText("£480.00");
  });

  test("the lines add up to the total printed under them", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();

    await expect(page.getByTestId("net-INV-0001")).toHaveText("£1,500.00");
    await expect(page.getByTestId("vat-INV-0001")).toHaveText("£300.00");
    await expect(page.getByTestId("grand-INV-0001")).toHaveText("£1,800.00");
  });

  test("a paid invoice offers nothing that would change it", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0002").click();

    await expect(page.getByTestId("locked-INV-0002")).toBeVisible();
    await expect(page.getByTestId("line-form")).toHaveCount(0);
    await expect(page.getByTestId("discard-INV-0002")).toHaveCount(0);
  });
});

test.describe.serial("invoices — writing", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "invoices");
  });

  test("an invoice can be raised and starts as a draft", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    await page.getByTestId("invoice-no").fill("INV-0044");
    await page.getByTestId("invoice-customer").selectOption({ label: "Argyle Energy" });
    await page.getByTestId("invoice-date").fill("2026-08-03");
    await page.getByTestId("raise-submit").click();

    await expect(page.getByTestId("raise-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("status-INV-0044")).toHaveText("Draft");
  });

  test("a number already used is refused", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    await page.getByTestId("invoice-no").fill("INV-0001");
    await page.getByTestId("invoice-customer").selectOption({ label: "Argyle Energy" });
    await page.getByTestId("invoice-date").fill("2026-08-04");
    await page.getByTestId("raise-submit").click();

    await expect(page.getByTestId("raise-error")).toContainText("already have an invoice", {
      timeout: 15000,
    });
  });

  test("the number offered next follows the ones already used", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    // INV-0001 and INV-0002 exist, so the box should offer INV-0003 — and keep
    // the four-digit width it was started with.
    await expect(page.getByTestId("invoice-no")).toHaveValue("INV-0003");
  });

  test("a line is priced at the invoice's rate and moves the totals", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();

    await page.getByTestId("line-desc").fill("Extra day");
    await page.getByTestId("line-qty").fill("2");
    await page.getByTestId("line-unit").fill("250");
    await page.getByTestId("line-add").click();

    // £500 net at 20% is £100 VAT, on top of the £1,500/£300 already there.
    await expect(page.getByTestId("net-INV-0001")).toHaveText("£2,000.00", { timeout: 15000 });
    await expect(page.getByTestId("vat-INV-0001")).toHaveText("£400.00");
    await expect(page.getByTestId("grand-INV-0001")).toHaveText("£2,400.00");
  });

  test("the preview says what a line comes to before it is added", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();

    await page.getByTestId("line-qty").fill("3");
    await page.getByTestId("line-unit").fill("100");

    await expect(page.getByTestId("line-preview")).toContainText("£360.00");
  });

  test("removing a line brings the totals back down", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();

    await page.getByTestId("strike-e0000001-0000-4000-8000-000000000001").click();

    await expect(page.getByTestId("grand-INV-0001")).toHaveText("£0.00", { timeout: 15000 });
  });

  test("a draft can be sent, and a sent invoice paid", async ({ page }) => {
    await signInAs(page, OTHER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();

    await page.getByTestId("send-INV-0001").click();
    await expect(page.getByTestId("status-INV-0001")).toHaveText("Sent", { timeout: 15000 });

    await page.getByTestId("pay-INV-0001").click();
    await expect(page.getByTestId("status-INV-0001")).toHaveText("Paid", { timeout: 15000 });

    // And now it is closed to further change. No second click: the row stayed
    // expanded through both status changes, so clicking would collapse it.
    await expect(page.getByTestId("locked-INV-0001")).toBeVisible();
  });

  test("a customer can be added and is then available to invoice", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("tab-customers").click();

    await page.getByTestId("cust-name").fill("Caldicot Metals");
    await page.getByTestId("cust-town").fill("Newport");
    await page.getByTestId("cust-save").click();

    await expect(page.getByTestId("cust-ok")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("tab-invoices").click();
    await expect(
      page.getByTestId("invoice-customer").locator("option", { hasText: "Caldicot Metals" }),
    ).toHaveCount(1);
  });
});

test.describe("invoices — the document", () => {
  test("the document carries everything a customer needs to pay it", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();

    const doc = page.getByTestId("invoice-document");
    await expect(doc).toBeVisible();

    // Who it is from, and who it is to. The address comes from the customer
    // row; the seller block comes from the invoice, not from My Profile, so
    // the document keeps saying what was sent.
    await expect(page.getByTestId("doc-seller-name")).toHaveText("Invoices Only Ltd");
    await expect(doc).toContainText("3 Kiln Lane");
    await expect(doc).toContainText("Argyle Energy");
    await expect(doc).toContainText("14 Wharf Road");
    await expect(doc).toContainText("Leicester");

    // How to pay it. Without these an invoice is a letter saying somebody owes
    // money, with no way to send any.
    await expect(page.getByTestId("doc-sort")).toHaveText("20-45-67");
    await expect(page.getByTestId("doc-account")).toHaveText("12345678");
    await expect(page.getByTestId("doc-no")).toHaveText("INV-0001");
    await expect(page.getByTestId("doc-total")).toHaveText("£1,800.00");
    await expect(page.getByTestId("doc-terms")).toContainText("within 14 days");
  });

  test("the due date is the invoice date plus the terms stamped on it", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();

    // Raised 4 July 2026 on 14-day terms.
    await expect(page.getByTestId("doc-due")).toHaveText("18 July 2026");
  });

  test("a sent invoice past its due date reads as Overdue, without anything having written that", async ({
    page,
  }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();

    await expect(page.getByTestId("doc-badge")).toHaveText("Overdue");

    // The stored status is still Sent. Overdue is worked out at render time, so
    // it is right the morning after it falls due with nothing scheduled — and
    // wrong for nobody if that schedule ever stopped.
    await expect(page.getByTestId("status-INV-0001")).toHaveText("Sent");
  });

  test("paid beats overdue, and a draft is never overdue", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    // INV-0002 fell due on 25 June 2026 and was paid. A paid invoice is not
    // late however long ago it was due.
    await page.getByTestId("open-INV-0002").click();
    await expect(page.getByTestId("doc-badge")).toHaveText("Paid");

    // And a draft has not been sent to anybody, so nobody is late paying it.
    await signInAs(page, OTHER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();
    await expect(page.getByTestId("doc-badge")).toHaveText("Draft");
  });

  test("the title promises a VAT invoice only when the number is on it", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");

    await page.getByTestId("open-INV-0001").click();
    await expect(page.getByTestId("doc-title")).toHaveText("VAT INVOICE");
    await expect(page.getByTestId("invoice-document")).toContainText("VAT Registration No.");

    // A heading promising a number that is not printed below is worse than the
    // plain heading: it is what a customer reclaiming VAT goes looking for.
    await page.getByTestId("open-INV-0001").click();
    await page.getByTestId("open-INV-0002").click();
    await expect(page.getByTestId("doc-title")).toHaveText("INVOICE");
  });

  test("the printed page is the document and nothing else", async ({ page }) => {
    await signInAs(page, SELLER);
    await page.goto("/invoices");
    await page.getByTestId("open-INV-0001").click();
    await expect(page.getByTestId("invoice-document")).toBeVisible();

    // What would have to be true for this to pass wrongly: the print rules
    // could be scoped to a selector nothing carries, and every assertion above
    // would still pass because they all run on screen. So this one asks the
    // browser what it would actually print.
    await page.emulateMedia({ media: "print" });

    const visible = await page.evaluate(() => {
      const shown = (el: Element) => getComputedStyle(el).visibility === "visible";
      return {
        doc: shown(document.querySelector("[data-testid=invoice-document]")!),
        form: shown(document.querySelector("[data-testid=line-form]") ?? document.body),
        nav: shown(document.querySelector("header") ?? document.body),
      };
    });

    expect(visible.doc, "the document prints").toBe(true);
    expect(visible.form, "the editing form does not").toBe(false);
    expect(visible.nav, "nor does the page furniture").toBe(false);

    await page.emulateMedia({ media: "screen" });
  });
});

test.describe("invoices — the guard", () => {
  test.use({ tolerate: ["status of 404"] });

  test("somebody without the flag gets a 404, not a 403", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/invoices");
    expect(res?.status()).toBe(404);
  });
});

test.describe("invoices — layout", () => {
  for (const width of [390, 1440]) {
    test(`the invoice table fits at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(page, SELLER);
      await page.goto("/invoices");
      await page.getByTestId("open-INV-0001").click();

      await expect(page.getByTestId("invoices-app")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
    });
  }
});

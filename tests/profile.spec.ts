import { expect, resetStaff, signInAs, test } from "./harness";

/**
 * My Profile — the only app with no flag. Every active staff member has it
 * (CLAUDE.md rule 10), and what it holds is what Invoices stamps onto a
 * document a customer reads.
 */

const COMPLETE = "invoices.only@example.test";
const PARTIAL = "everything@example.test";
const NO_FLAGS = "no.flags@example.test";

test.describe("profile — reading", () => {
  test("a complete profile says so", async ({ page }) => {
    await signInAs(page, COMPLETE);
    await page.goto("/profile");

    await expect(page.getByTestId("profile-app")).toBeVisible();
    await expect(page.getByTestId("invoice-readiness")).toContainText("Ready to invoice");
    await expect(page.getByTestId("business-name")).toHaveValue("Invoices Only Ltd");
  });

  test("the sort code is shown grouped, however it was stored", async ({ page }) => {
    await signInAs(page, COMPLETE);
    await page.goto("/profile");

    // Stored as six digits; displayed the way somebody would read it aloud.
    await expect(page.getByTestId("sort-code")).toHaveValue("20-45-67");
  });

  test("an incomplete profile names what an invoice would be missing", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await expect(page.getByTestId("invoice-readiness")).toContainText("would be incomplete");
    await expect(page.getByTestId("missing-sort-code")).toBeVisible();
    await expect(page.getByTestId("missing-account-number")).toBeVisible();
    await expect(page.getByTestId("missing-business-address")).toBeVisible();
  });

  test("somebody with no app flags still has this page", async ({ page }) => {
    await signInAs(page, NO_FLAGS);
    const res = await page.goto("/profile");

    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("profile-app")).toBeVisible();
  });

  test("the VAT number is only offered when the business is registered", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await expect(page.getByTestId("vat-number")).toHaveCount(0);
    await page.getByTestId("vat-registered").selectOption("yes");
    await expect(page.getByTestId("vat-number")).toBeVisible();
  });
});

test.describe.serial("profile — writing", () => {
  test.beforeEach(async ({ page }) => {
    await resetStaff(page);
  });

  test("filling in what was missing turns the page green", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await page.getByTestId("business-address").fill("9 Foundry Row, Derby DE1 1AB");
    await page.getByTestId("account-name").fill("Everything Consulting");
    await page.getByTestId("sort-code").fill("30 99 12");
    await page.getByTestId("account-no").fill("87654321");
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("invoice-readiness")).toContainText("Ready to invoice");
  });

  test("a sort code is accepted however it is typed, and stored one way", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await page.getByTestId("sort-code").fill("30-99-12");
    await page.getByTestId("account-no").fill("8765 4321");
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-ok")).toBeVisible({ timeout: 15000 });

    await page.reload();
    await expect(page.getByTestId("sort-code")).toHaveValue("30-99-12");
    await expect(page.getByTestId("account-no")).toHaveValue("87654321");
  });

  test("a half-typed sort code is refused rather than stored", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await page.getByTestId("sort-code").fill("3099");
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-error")).toContainText("six digits", { timeout: 15000 });
  });

  test("a VAT number without the registration is refused", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    // Turning registration off removes the VAT box, so this form cannot post
    // the pair — which is the right behaviour and also means the server check
    // is never reached from here. Put the field back and post anyway, as
    // anything other than this form would: the constraint refuses it, and an
    // invoice printing a VAT number it should not is a correction letter.
    await page.getByTestId("profile-form").evaluate((form) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "vatNumber";
      input.value = "GB999999999";
      form.appendChild(input);
    });
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-error")).toContainText("VAT", { timeout: 15000 });
  });
});

test.describe("profile — layout", () => {
  for (const width of [390, 1440]) {
    test(`the form fits at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(page, COMPLETE);
      await page.goto("/profile");

      await expect(page.getByTestId("profile-app")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
    });
  }
});

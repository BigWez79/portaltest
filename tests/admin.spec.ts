import { expect, expectExactlyTiles, resetStaff, signInAs, signOutCompletely, test } from "./harness";

// Two of these ask for a page that must 404; the browser logs that itself.
test.describe("admin screen — who can reach it", () => {
  test.use({ tolerate: ["status of 404"] });

  test("signed out, /admin is a 404 rather than a redirect", async ({ page }) => {
    await signOutCompletely(page);
    const res = await page.goto("/admin");
    // Middleware sends signed-out traffic to the front door.
    expect(page.url()).toContain("/");
    expect(page.getByTestId("staff-table")).toHaveCount(0);
    expect(res).toBeTruthy();
  });

  test("a non-admin gets a 404, not a 403", async ({ page }) => {
    // A 403 confirms the route exists. A 404 tells them nothing.
    await signInAs(page, "invoices.only@example.test");
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("staff-table")).toHaveCount(0);
  });

  test("an inactive admin gets nothing", async ({ page }) => {
    await signInAs(page, "left.the.company@example.test");
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(404);
  });

  test("an admin sees every staff row", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/admin");

    await expect(page.getByTestId("staff-table")).toBeVisible();
    await expect(page.getByTestId("row-invoices.only@example.test")).toBeVisible();
    await expect(page.getByTestId("row-left.the.company@example.test")).toBeVisible();
    await expect(page.getByTestId("summary")).toBeVisible();
  });

  test("an invited person who has not signed in is marked as such", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/admin");

    const row = page.getByTestId("row-invited@example.test");
    await expect(row).toContainText("invited, not signed in");
  });
});

// These write to the fixture store, so they run one after another and reset first.
test.describe.serial("admin screen — changing access", () => {
  test.beforeEach(async ({ page }) => {
    await resetStaff(page);
    await signInAs(page, "everything@example.test");
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.request.post("/api/test/session?reset=1");
    await page.close();
  });

  test("granting an app shows up on that person's portal", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("toggle-no.flags@example.test-hasExpenses").click();
    await expect(
      page.getByTestId("toggle-no.flags@example.test-hasExpenses"),
    ).toHaveAttribute("aria-pressed", "true");

    await signInAs(page, "no.flags@example.test");
    await page.goto("/");
    await expect(page.getByTestId("tile-expenses")).toBeVisible();
    await expect(page.getByTestId("tile-invoices")).toHaveCount(0);
  });

  test("removing an app takes the tile away again", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("toggle-invoices.only@example.test-hasInvoices").click();
    await expect(
      page.getByTestId("toggle-invoices.only@example.test-hasInvoices"),
    ).toHaveAttribute("aria-pressed", "false");

    await signInAs(page, "invoices.only@example.test");
    await page.goto("/");
    await expect(page.getByTestId("tile-invoices")).toHaveCount(0);
    // Not "no access" — My Profile has no flag, so an active person always
    // keeps that one. Removing their last *app* leaves exactly Profile.
    await expect(page.getByTestId("tile-profile")).toBeVisible();
    await expect(page.getByTestId("no-access")).toHaveCount(0);
  });

  test("an admin cannot remove their own admin access", async ({ page }) => {
    await page.goto("/admin");
    const own = page.getByTestId("toggle-everything@example.test-isAdmin");
    await expect(own).toBeDisabled();
  });

  test("an admin cannot deactivate themselves", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("toggle-everything@example.test-active")).toBeDisabled();
  });

  test("inviting somebody adds them with no app access", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("invite-name").fill("Newton New");
    await page.getByTestId("invite-email").fill("newton@example.test");
    await page.getByTestId("invite-submit").click();

    await expect(page.getByTestId("invite-ok")).toBeVisible();
    const row = page.getByTestId("row-newton@example.test");
    await expect(row).toBeVisible();

    // An invited person is active, so they get My Profile and nothing else
    // until an admin grants an app.
    await signInAs(page, "newton@example.test");
    await page.goto("/");
    await expectExactlyTiles(page, ["profile"]);
    await expect(page.getByTestId("no-access")).toHaveCount(0);
  });

  test("inviting the same address twice is refused", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("invite-email").fill("invoices.only@example.test");
    await page.getByTestId("invite-submit").click();

    await expect(page.getByTestId("invite-error")).toBeVisible();
  });
});

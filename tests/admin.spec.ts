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
    // Who changed whose access is admin-only too, and a 404 renders none of it.
    await expect(page.getByTestId("audit-trail")).toHaveCount(0);
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

/**
 * These write to the fixture store, so they run one after another and reset
 * first. They also flip flags only on `grantable@` and `revocable@`, who exist
 * for this suite alone.
 *
 * That matters because the store is one file shared by every worker: a suite
 * that toggles somebody another spec asserts on will, often enough to be
 * maddening, hand that spec the wrong answer. Serial ordering inside this file
 * does nothing about a spec running beside it.
 */
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
    await page.getByTestId("toggle-grantable@example.test-hasExpenses").click();
    await expect(
      page.getByTestId("toggle-grantable@example.test-hasExpenses"),
    ).toHaveAttribute("aria-pressed", "true");

    await signInAs(page, "grantable@example.test");
    await page.goto("/");
    await expect(page.getByTestId("tile-expenses")).toBeVisible();
    await expect(page.getByTestId("tile-invoices")).toHaveCount(0);
  });

  test("removing an app takes the tile away again", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("toggle-revocable@example.test-hasInvoices").click();
    await expect(
      page.getByTestId("toggle-revocable@example.test-hasInvoices"),
    ).toHaveAttribute("aria-pressed", "false");

    await signInAs(page, "revocable@example.test");
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

  test("a change is listed against that person, with the admin's name on it", async ({
    page,
  }) => {
    await page.goto("/admin");
    // Nothing has been changed since the reset, so the panel says so.
    await expect(page.getByTestId("audit")).toContainText("No access has been changed yet.");

    await page.getByTestId("toggle-grantable@example.test-hasExpenses").click();
    await expect(
      page.getByTestId("toggle-grantable@example.test-hasExpenses"),
    ).toHaveAttribute("aria-pressed", "true");

    const panel = page.getByTestId("audit-grantable@example.test");
    await expect(panel).toContainText("Granted Expenses");
    // The admin who made it, not the person it was made against.
    await expect(panel).toContainText("Ada Everything");
    await expect(panel).toContainText("Grace Grantable");
    await expect(panel.getByTestId("audit-entry")).toHaveCount(1);
  });

  test("the trail survives a reload and reads the same way", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("toggle-revocable@example.test-hasInvoices").click();
    await expect(
      page.getByTestId("toggle-revocable@example.test-hasInvoices"),
    ).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    const panel = page.getByTestId("audit-revocable@example.test");
    await expect(panel).toContainText("Removed Invoices");
    await expect(panel).toContainText("Ada Everything");
  });

  test("deactivating reads as deactivating, and adding as being added", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("toggle-grantable@example.test-active").click();
    await expect(page.getByTestId("audit-grantable@example.test")).toContainText(
      "Deactivated",
    );

    await page.getByTestId("invite-name").fill("Nadia Newcomer");
    await page.getByTestId("invite-email").fill("nadia@example.test");
    await page.getByTestId("invite-submit").click();
    await expect(page.getByTestId("invite-ok")).toBeVisible();

    await expect(page.getByTestId("audit-nadia@example.test")).toContainText(
      "Added to the staff list",
    );
  });

  test("signing in is not a change and does not appear in the trail", async ({ page }) => {
    // Only decisions belong here. `left.the.company@` is touched by nothing this
    // suite does, so nothing should be listed against them.
    await page.goto("/admin");
    await page.getByTestId("toggle-grantable@example.test-hasMargin").click();
    await expect(page.getByTestId("audit-trail")).toBeVisible();
    await expect(page.getByTestId("audit-left.the.company@example.test")).toHaveCount(0);
  });

  // The named widths, with something actually in the panel — an empty trail
  // would not tell us whether a long entry pushes the page sideways.
  //
  // The assertion is on the panel rather than the document: at 390 the staff
  // table already makes the whole page scroll sideways, which predates this and
  // is a change to how the admin screen looks. What is checkable here is that
  // the trail itself stays inside the viewport, and the screenshots are attached
  // for a person to look at.
  for (const w of [
    { name: "390-phone", width: 390, height: 844 },
    { name: "1440-desktop", width: 1440, height: 900 },
  ]) {
    test(`the trail fits at ${w.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/admin");
      await page.getByTestId("toggle-grantable@example.test-hasTaxBreakdown").click();
      await expect(page.getByTestId("audit-grantable@example.test")).toContainText(
        "Granted Tax Breakdown",
      );

      const spill = await page
        .getByTestId("audit-trail")
        .evaluate(
          (el) =>
            el.getBoundingClientRect().right - document.documentElement.clientWidth,
        );
      expect(spill, "the audit trail must stay inside the viewport").toBeLessThanOrEqual(0);

      await testInfo.attach(`admin-audit-${w.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }

  test("inviting the same address twice is refused", async ({ page }) => {
    await page.goto("/admin");
    await page.getByTestId("invite-email").fill("invoices.only@example.test");
    await page.getByTestId("invite-submit").click();

    await expect(page.getByTestId("invite-error")).toBeVisible();
  });

  /**
   * Deactivating somebody ends their session, rather than leaving them looking
   * at a signed-in suite with a no-access notice.
   *
   * These live inside this block rather than a serial block of their own: with
   * fullyParallel, two describe.serial groups in one file are scheduled as two
   * units and can run in different workers at once, so the beforeEach reset
   * above would land in the middle of a toggle down here and put `active` back.
   * That is not hypothetical — it is what these did on the first run.
   *
   * They move `active` only on `session.holder@`, who exists for them and
   * nothing else.
   *
   * What would have to be true for this to pass while the thing it checks is
   * broken (CLAUDE.md 12): the sign-in card would have to be showing for some
   * reason other than the revocation. Two guards against that — the portal is
   * asserted to be signed in *before* the toggle, so the cookie was working —
   * and `no-access` and `user-name` are asserted absent afterwards, which is
   * exactly what the old behaviour rendered. A test that only looked for
   * `login-view` would also pass if the seeder had quietly stopped planting
   * anything.
   */
  test("the deactivated person's next page is the sign-in card", async ({ page, browser }) => {
    // Two contexts on purpose. The session being ended has to be somebody
    // else's — an admin cannot deactivate themselves, and a test that signed
    // the same browser in twice would be testing the seeder, not the revoke.
    const admin = await browser.newPage();
    try {
      await signInAs(admin, "everything@example.test", { name: "Ada Everything" });

      await signInAs(page, "session.holder@example.test", { name: "Sasha Session" });
      await page.goto("/");
      await expect(page.getByTestId("user-name")).toHaveText("Sasha Session");
      await expect(page.getByTestId("tile-invoices")).toBeVisible();

      await admin.goto("/admin");
      const toggle = admin.getByTestId("toggle-session.holder@example.test-active");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");

      await page.goto("/");
      await expect(page.getByTestId("login-view")).toBeVisible();
      await expect(page.getByTestId("no-access")).toHaveCount(0);
      await expect(page.getByTestId("user-name")).toHaveCount(0);
      await expectExactlyTiles(page, []);
    } finally {
      await admin.close();
    }
  });

  test("signing in again afterwards works", async ({ page, browser }) => {
    // The revocation ends the sessions that exist, not the address. Somebody
    // reactivated has to be able to sign in again, and a revoke that killed
    // every future session too would look identical in the test above.
    const admin = await browser.newPage();
    try {
      await signInAs(admin, "everything@example.test");
      await signInAs(page, "session.holder@example.test");

      await admin.goto("/admin");
      await admin.getByTestId("toggle-session.holder@example.test-active").click();
      await expect(
        admin.getByTestId("toggle-session.holder@example.test-active"),
      ).toHaveAttribute("aria-pressed", "false");

      await page.goto("/");
      await expect(page.getByTestId("login-view")).toBeVisible();

      await admin.getByTestId("toggle-session.holder@example.test-active").click();
      await expect(
        admin.getByTestId("toggle-session.holder@example.test-active"),
      ).toHaveAttribute("aria-pressed", "true");

      await signInAs(page, "session.holder@example.test", { name: "Sasha Session" });
      await page.goto("/");
      await expect(page.getByTestId("user-name")).toHaveText("Sasha Session");
      await expect(page.getByTestId("tile-invoices")).toBeVisible();
    } finally {
      await admin.close();
    }
  });

  test("nobody else is signed out by it", async ({ page, browser }) => {
    // The revoke is per address. A store keyed wrongly — or one file for the
    // lot — would take out whoever else happened to be signed in, and the
    // suite runs several workers who are.
    const admin = await browser.newPage();
    const bystander = await browser.newPage();
    try {
      await signInAs(admin, "everything@example.test");
      await signInAs(page, "session.holder@example.test");
      await signInAs(bystander, "invoices.only@example.test", { name: "Ivor Invoices" });
      await bystander.goto("/");

      await admin.goto("/admin");
      await admin.getByTestId("toggle-session.holder@example.test-active").click();
      await expect(
        admin.getByTestId("toggle-session.holder@example.test-active"),
      ).toHaveAttribute("aria-pressed", "false");

      await page.goto("/");
      await expect(page.getByTestId("login-view")).toBeVisible();

      await bystander.goto("/");
      await expect(bystander.getByTestId("user-name")).toHaveText("Ivor Invoices");
    } finally {
      await bystander.close();
      await admin.close();
    }
  });
});

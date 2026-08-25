import { expect, signInAs, signOutCompletely, test } from "./harness";

/**
 * Every app is a route in this deployment, behind the same guard. These are the
 * checks that stop a port shipping an unguarded page: the route exists and is
 * gated before any of the app's own code arrives.
 */
/**
 * `landmark` is what proves the page actually rendered. It is "not-ported" for
 * the routes still waiting on their app's own code, and the app's own root once
 * that app has been folded in — Margin is the first of those.
 */
const FLAGGED = [
  { path: "/invoices", holder: "invoices.only@example.test", landmark: "not-ported" },
  { path: "/timesheets", holder: "timesheet.only@example.test", landmark: "not-ported" },
  { path: "/expenses", holder: "expenses.only@example.test", landmark: "not-ported" },
  { path: "/margin", holder: "margin.only@example.test", landmark: "margin-calculator" },
  { path: "/tax-breakdown", holder: "tax.only@example.test", landmark: "not-ported" },
];

test.describe("app routes", () => {
  test.use({ tolerate: ["status of 404"] });

  for (const route of FLAGGED) {
    test(`${route.path} opens for somebody with the flag`, async ({ page }) => {
      await signInAs(page, route.holder);
      const res = await page.goto(route.path);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId(route.landmark)).toBeVisible();
    });

    test(`${route.path} 404s without the flag`, async ({ page }) => {
      // Active staff, but not for this app.
      await signInAs(page, "no.flags@example.test");
      const res = await page.goto(route.path);
      expect(res?.status()).toBe(404);
    });

    test(`${route.path} 404s when signed out`, async ({ page }) => {
      await signOutCompletely(page);
      await page.goto(route.path);
      await expect(page.getByTestId("login-view")).toBeVisible();
      await expect(page.getByTestId(route.landmark)).toHaveCount(0);
    });

    test(`${route.path} 404s for a deactivated person who used to have it`, async ({
      page,
    }) => {
      await signInAs(page, "left.the.company@example.test");
      const res = await page.goto(route.path);
      expect(res?.status()).toBe(404);
    });
  }

  // My Profile is the odd one out: no flag, just an active staff row.
  test("/profile opens for any active staff member, flags or not", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/profile");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("not-ported")).toBeVisible();
  });

  test("/profile 404s for a deactivated person", async ({ page }) => {
    await signInAs(page, "left.the.company@example.test");
    const res = await page.goto("/profile");
    expect(res?.status()).toBe(404);
  });

  test("/profile 404s for somebody with no staff row", async ({ page }) => {
    await signInAs(page, "never.heard.of.them@example.test");
    const res = await page.goto("/profile");
    expect(res?.status()).toBe(404);
  });

  test("the switcher offers only the apps this person may open", async ({ page }) => {
    await signInAs(page, "margin.only@example.test");
    await page.goto("/margin");
    // Margin and My Profile; standing on Margin leaves one to switch to.
    await expect(page.getByTestId("switch-profile")).toBeVisible();
    await expect(page.getByTestId("switch-invoices")).toHaveCount(0);
    await expect(page.getByTestId("switch-margin")).toHaveCount(0);

    await signInAs(page, "everything@example.test");
    await page.goto("/timesheets");
    for (const id of ["invoices", "expenses", "margin", "taxBreakdown", "profile", "admin"]) {
      await expect(page.getByTestId(`switch-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("switch-timesheet")).toHaveCount(0);
  });

  test("the tiles link to routes in this app, not to subdomains", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/");

    for (const [id, href] of [
      ["invoices", "/invoices"],
      ["timesheet", "/timesheets"],
      ["expenses", "/expenses"],
      ["margin", "/margin"],
      ["taxBreakdown", "/tax-breakdown"],
      ["profile", "/profile"],
      ["admin", "/admin"],
    ]) {
      await expect(page.getByTestId(`tile-${id}`)).toHaveAttribute("href", href);
    }
  });
});

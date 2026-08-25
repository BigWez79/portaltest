import { expect, signInAs, signOutCompletely, test } from "./harness";

/**
 * Every app is a route in this deployment, behind the same guard. These are the
 * checks that stop a port shipping an unguarded page: the route exists and is
 * gated before any of the app's own code arrives.
 */
const ROUTES = [
  { path: "/invoices", flagHolder: "invoices.only@example.test", title: "Invoices" },
  { path: "/timesheets", flagHolder: "timesheet.only@example.test", title: "Timesheets" },
  { path: "/expenses", flagHolder: "expenses.only@example.test", title: "Expenses" },
];

test.describe("app routes", () => {
  test.use({ tolerate: ["status of 404"] });

  for (const route of ROUTES) {
    test(`${route.path} opens for somebody with the flag`, async ({ page }) => {
      await signInAs(page, route.flagHolder);
      const res = await page.goto(route.path);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("not-ported")).toBeVisible();
    });

    test(`${route.path} 404s without the flag`, async ({ page }) => {
      // Somebody with a different app's flag — signed in, but not for this one.
      await signInAs(page, "no.flags@example.test");
      const res = await page.goto(route.path);
      expect(res?.status()).toBe(404);
    });

    test(`${route.path} 404s when signed out`, async ({ page }) => {
      await signOutCompletely(page);
      await page.goto(route.path);
      // Middleware sends signed-out traffic to the front door.
      await expect(page.getByTestId("login-view")).toBeVisible();
      await expect(page.getByTestId("not-ported")).toHaveCount(0);
    });

    test(`${route.path} 404s for a deactivated person who used to have it`, async ({
      page,
    }) => {
      await signInAs(page, "left.the.company@example.test");
      const res = await page.goto(route.path);
      expect(res?.status()).toBe(404);
    });
  }

  test("the switcher offers only the apps this person may open", async ({ page }) => {
    await signInAs(page, "timesheet.only@example.test");
    await page.goto("/timesheets");

    // Their only app is the one they are on, so there is nothing to switch to.
    await expect(page.getByTestId("switcher")).toHaveCount(0);

    await signInAs(page, "everything@example.test");
    await page.goto("/timesheets");
    await expect(page.getByTestId("switch-invoices")).toBeVisible();
    await expect(page.getByTestId("switch-expenses")).toBeVisible();
    await expect(page.getByTestId("switch-admin")).toBeVisible();
    // Not a link to the page you are already on.
    await expect(page.getByTestId("switch-timesheet")).toHaveCount(0);
  });

  test("the tiles link to routes in this app, not to subdomains", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/");

    for (const [id, href] of [
      ["invoices", "/invoices"],
      ["timesheet", "/timesheets"],
      ["expenses", "/expenses"],
      ["admin", "/admin"],
    ]) {
      await expect(page.getByTestId(`tile-${id}`)).toHaveAttribute("href", href);
    }
  });
});

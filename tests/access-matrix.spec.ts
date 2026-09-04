import {
  expect,
  expectExactlyTiles,
  sessionCookie,
  signInAs,
  signOutCompletely,
  test,
} from "./harness";

/**
 * Mirrors what the live portal (v2.1) actually does.
 *
 * Note "profile": My Profile has no flag on the live portal — every active
 * staff member gets it. So an active person with no app flags sees one tile
 * rather than an empty portal.
 */
test.describe("access matrix", () => {
  test("signed out: the sign-in card, and no tile in the DOM", async ({ page }) => {
    await signOutCompletely(page);
    await page.goto("/");

    await expect(page.getByTestId("login-view")).toBeVisible();
    await expect(page.getByTestId("email")).toBeVisible();
    await expect(page.getByTestId("signin")).toBeVisible();
    await expectExactlyTiles(page, []);
    await expect(page.getByTestId("tiles")).toHaveCount(0);
  });

  const cases: Array<{ who: string; email: string; name: string; tiles: string[] }> = [
    {
      who: "every flag and admin",
      email: "everything@example.test",
      name: "Ada Everything",
      tiles: ["invoices", "timesheet", "expenses", "margin", "taxBreakdown", "profile", "admin"],
    },
    {
      who: "invoices only",
      email: "invoices.only@example.test",
      name: "Ivor Invoices",
      tiles: ["invoices", "profile"],
    },
    {
      who: "timesheet only",
      email: "timesheet.only@example.test",
      name: "Tessa Timesheet",
      tiles: ["timesheet", "profile"],
    },
    {
      who: "expenses only",
      email: "expenses.only@example.test",
      name: "Eve Expenses",
      tiles: ["expenses", "profile"],
    },
    {
      who: "margin only",
      email: "margin.only@example.test",
      name: "Marge Margin",
      tiles: ["margin", "profile"],
    },
    {
      who: "tax breakdown only",
      email: "tax.only@example.test",
      name: "Tex Tax",
      tiles: ["taxBreakdown", "profile"],
    },
    {
      who: "admin with no app flags",
      email: "admin.only@example.test",
      name: "Adam Admin",
      tiles: ["profile", "admin"],
    },
  ];

  for (const c of cases) {
    test(`${c.who} sees exactly ${c.tiles.join(", ")}`, async ({ page }) => {
      await signInAs(page, c.email);
      await page.goto("/");

      await expect(page.getByTestId("user-name")).toHaveText(c.name);
      await expectExactlyTiles(page, c.tiles);
    });
  }

  test("an active row with no app flags still gets My Profile", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/");

    await expectExactlyTiles(page, ["profile"]);
  });

  // Neither of these gets a portal at all. A session with no active staff row
  // behind it is ended on the next request rather than rendered as a signed-in
  // page with a warning in it, so the cookie has to be gone as well as the
  // tiles — an assertion on the card alone would pass with the session intact.
  test("an inactive row is signed out, even with every flag set", async ({ page }) => {
    await signInAs(page, "left.the.company@example.test");
    await page.goto("/");

    await expect(page.getByTestId("login-view")).toBeVisible();
    await expect(page.getByTestId("access-ended")).toBeVisible();
    await expectExactlyTiles(page, []);
    await expect(await sessionCookie(page)).toBeUndefined();
  });

  test("a person with no row at all is signed out", async ({ page }) => {
    await signInAs(page, "never.heard.of.them@example.test", { name: "Stranger" });
    await page.goto("/");

    await expect(page.getByTestId("login-view")).toBeVisible();
    await expect(page.getByTestId("access-ended")).toBeVisible();
    await expectExactlyTiles(page, []);
    await expect(await sessionCookie(page)).toBeUndefined();
  });

  test("the name on the staff row wins over the name on the session", async ({ page }) => {
    await signInAs(page, "invoices.only@example.test", { name: "ivor.invoices" });
    await page.goto("/");

    await expect(page.getByTestId("user-name")).toHaveText("Ivor Invoices");
  });
});

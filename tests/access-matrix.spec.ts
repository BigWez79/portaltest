import { expect, expectExactlyTiles, signInAs, signOutCompletely, test } from "./harness";

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
      tiles: ["invoices", "timesheet", "expenses", "admin"],
    },
    {
      who: "invoices only",
      email: "invoices.only@example.test",
      name: "Ivor Invoices",
      tiles: ["invoices"],
    },
    {
      who: "timesheet only",
      email: "timesheet.only@example.test",
      name: "Tessa Timesheet",
      tiles: ["timesheet"],
    },
    {
      who: "expenses only",
      email: "expenses.only@example.test",
      name: "Eve Expenses",
      tiles: ["expenses"],
    },
    {
      who: "admin with no app flags",
      email: "admin.only@example.test",
      name: "Adam Admin",
      tiles: ["admin"],
    },
  ];

  for (const c of cases) {
    test(`${c.who} sees exactly ${c.tiles.join(", ")}`, async ({ page }) => {
      await signInAs(page, c.email);
      await page.goto("/");

      await expect(page.getByTestId("user-name")).toHaveText(c.name);
      await expectExactlyTiles(page, c.tiles);
      await expect(page.getByTestId("no-access")).toHaveCount(0);
    });
  }

  test("an active row with no flags gets the no-access notice", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/");

    await expect(page.getByTestId("no-access")).toBeVisible();
    await expectExactlyTiles(page, []);
  });

  test("an inactive row grants nothing, even with every flag set", async ({ page }) => {
    await signInAs(page, "left.the.company@example.test");
    await page.goto("/");

    await expect(page.getByTestId("no-access")).toBeVisible();
    await expectExactlyTiles(page, []);
  });

  test("a person with no row at all grants nothing", async ({ page }) => {
    await signInAs(page, "never.heard.of.them@example.test", { name: "Stranger" });
    await page.goto("/");

    await expect(page.getByTestId("no-access")).toBeVisible();
    await expectExactlyTiles(page, []);
  });

  test("the name on the staff row wins over the name on the session", async ({
    page,
  }) => {
    await signInAs(page, "invoices.only@example.test", { name: "ivor.invoices" });
    await page.goto("/");

    await expect(page.getByTestId("user-name")).toHaveText("Ivor Invoices");
  });
});

import { expect, expectExactlyTiles, signInAs, signOutCompletely, test } from "./harness";

/**
 * Mirrors what the live portal (v2.1) actually does.
 *
 * Note "profile": My Profile has no flag on the live portal — every active
 * staff member gets it. So an active person with no app flags sees one tile,
 * not the no-access notice.
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
      await expect(page.getByTestId("no-access")).toHaveCount(0);
    });
  }

  test("an active row with no app flags still gets My Profile", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/");

    await expectExactlyTiles(page, ["profile"]);
    await expect(page.getByTestId("no-access")).toHaveCount(0);
  });

  test("an inactive row is signed out, not shown a portal with a warning", async ({
    page,
  }) => {
    await signInAs(page, "left.the.company@example.test");
    await page.goto("/");

    await expect(page.getByTestId("login-view")).toBeVisible();
    await expect(page.getByTestId("no-access")).toHaveCount(0);
    await expectExactlyTiles(page, []);

    // Signed out, not merely shown the card: the cookie is gone.
    const session = (await page.context().cookies()).find((c) => c.name === "e2e-session");
    expect(session, "the session cookie should have been cleared").toBeUndefined();
  });

  // Not signed out, unlike the inactive row above. No row is not a statement
  // that somebody was deactivated — a lookup that failed looks exactly the same
  // from here, and ending sessions on a failed query is its own outage.
  test("a person with no row at all grants nothing, and keeps their session", async ({
    page,
  }) => {
    await signInAs(page, "never.heard.of.them@example.test", { name: "Stranger" });
    await page.goto("/");

    await expect(page.getByTestId("no-access")).toBeVisible();
    await expectExactlyTiles(page, []);

    const session = (await page.context().cookies()).find((c) => c.name === "e2e-session");
    expect(session, "no row is not grounds for ending a session").toBeDefined();
  });

  // The button was never clicked by anything until now, and under the suite it
  // left the session cookie exactly where it was.
  test("the Sign out button ends the session", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/");
    await expect(page.getByTestId("tile-profile")).toBeVisible();

    await page.getByTestId("signout").click();
    await expect(page.getByTestId("login-view")).toBeVisible();

    const session = (await page.context().cookies()).find((c) => c.name === "e2e-session");
    expect(session, "the session cookie should have been cleared").toBeUndefined();
  });

  test("the name on the staff row wins over the name on the session", async ({ page }) => {
    await signInAs(page, "invoices.only@example.test", { name: "ivor.invoices" });
    await page.goto("/");

    await expect(page.getByTestId("user-name")).toHaveText("Ivor Invoices");
  });
});

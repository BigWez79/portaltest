import { axeScan, expect, signInAs, signOutCompletely, test } from "./harness";

/**
 * The accessibility pass.
 *
 * Two halves. The first is axe against the two screens a person actually uses —
 * the tiles page signed out and signed in, and the staff table — at the
 * narrowest and the widest supported width, with the screenshot attached. The
 * second is the three things about the table that axe cannot see: which column a
 * toggle belongs to, which person it belongs to, and what order the keyboard
 * walks a row in.
 *
 * What would have to be true for this to pass while the thing it checks is
 * broken (rule 12):
 *
 *  - axe finds nothing on a page that never rendered. Every scan asserts what it
 *    came to look at is on the screen first, and `axeScan` asserts axe came back
 *    having applied rules at all.
 *  - axe finds nothing in a part of the page it was told to skip. Nothing is
 *    excluded and no rule is disabled, so a violation introduced anywhere on
 *    these routes fails this file.
 *  - the staff table only carries its harder colours when the list contains the
 *    people who trigger them: somebody deactivated, somebody invited who has not
 *    signed in, and the reader's own row with the two toggles they may not
 *    change. A scan of a table showing none of those proves much less, so each is
 *    asserted present rather than assumed from the fixture file.
 *  - axe reads colour off the rendered page, so it says nothing about a state it
 *    never sees. The one on this screen that needs a write to reach is a
 *    populated audit trail; it is scanned in `admin.spec.ts`, inside the serial
 *    suite that is allowed to write, and not here.
 */

const WIDTHS = [
  { name: "390-phone", width: 390, height: 844 },
  { name: "1440-desktop", width: 1440, height: 900 },
];

test.describe("axe", () => {
  // Triple the budget, not a weaker check. The staff screen is 84 toggles, and
  // scanning every one of them for contrast and then photographing the lot at
  // 390 takes about 20 seconds on an idle box — more with every other worker on
  // it. It was seen finishing in 16s alone and timing out at 30s on a full run.
  test.slow();

  for (const w of WIDTHS) {
    test(`the sign-in card is clean at ${w.name}`, async ({ page }, testInfo) => {
      await signOutCompletely(page);
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");
      await expect(page.getByTestId("login-view")).toBeVisible();
      await axeScan(page, testInfo, `signin-${w.name}`);
    });

    test(`the tiles page is clean at ${w.name}`, async ({ page }, testInfo) => {
      await signInAs(page, "everything@example.test");
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");
      await expect(page.getByTestId("tiles")).toBeVisible();
      await axeScan(page, testInfo, `home-${w.name}`);
    });

    test(`the staff screen is clean at ${w.name}`, async ({ page }, testInfo) => {
      await signInAs(page, "everything@example.test");
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/admin");
      await expect(page.getByTestId("staff-table")).toBeVisible();

      await expect(
        page.locator("tr.inactive"),
        "the list should include somebody deactivated",
      ).not.toHaveCount(0);
      await expect(
        page.locator(".pending"),
        "the list should include somebody invited who has not signed in",
      ).not.toHaveCount(0);
      await expect(
        page.getByTestId("toggle-everything@example.test-isAdmin"),
        "the reader's own row carries the toggles they may not change",
      ).toBeDisabled();
      await expect(page.getByTestId("audit")).toBeVisible();
      await expect(page.getByTestId("invite-form")).toBeVisible();

      await axeScan(page, testInfo, `admin-${w.name}`);
    });
  }
});

test.describe("the staff table, read rather than seen", () => {
  // Not the reader, and active, so every toggle in the row is live.
  const OTHER = { email: "no.flags@example.test", name: "Nora Noflags" };

  const COLUMNS = [
    { flag: "hasInvoices", label: "Invoices", short: "Inv" },
    { flag: "hasTimesheet", label: "Timesheets", short: "Time" },
    { flag: "hasExpenses", label: "Expenses", short: "Exp" },
    { flag: "hasMargin", label: "Margin", short: "Marg" },
    { flag: "hasTaxBreakdown", label: "Tax", short: "Tax" },
    { flag: "isAdmin", label: "Admin", short: "Admin" },
    // The Active column's heading is a single span — nothing to abbreviate.
    { flag: "active", label: "Active", short: "" },
  ];

  for (const w of WIDTHS) {
    test(`every column is announced by its full name at ${w.name}`, async ({ page }) => {
      await signInAs(page, "everything@example.test");
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/admin");
      await expect(page.getByTestId("staff-table")).toBeVisible();

      const headers = page.getByTestId("staff-table").getByRole("columnheader");
      const abbreviated = w.width <= 720;

      await expect(headers).toHaveCount(COLUMNS.length + 1);

      // What is announced: the full word, at both widths.
      for (const [i, name] of ["Person", ...COLUMNS.map((c) => c.label)].entries()) {
        await expect(
          headers.nth(i),
          `column ${i} should be announced as "${name}" at ${w.name}`,
        ).toHaveAccessibleName(name);
      }

      // What is drawn: abbreviated below 720px, because seven columns and a name
      // do not fit a phone.
      //
      // Measured rather than read. The full word is still in the markup at 390 —
      // that is the whole trick, and it is why the accessible name above holds —
      // so innerText returns both spans and cannot tell which one a person sees.
      // Its box can: the hidden one is clipped to a pixel, or absent entirely.
      for (const [i, c] of COLUMNS.entries()) {
        if (!c.short) continue; // the Active column is one word at either width
        const box = await headers.nth(i + 1).evaluate((th) => {
          const width = (sel: string) =>
            (th.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect()
              .width ?? 0;
          return { long: width(".th-long"), short: width(".th-short") };
        });
        const [drawn, hidden] = abbreviated
          ? ([box.short, box.long] as const)
          : ([box.long, box.short] as const);
        expect(
          drawn,
          `${c.label} should be drawn as "${abbreviated ? c.short : c.label}" at ${w.name}`,
        ).toBeGreaterThan(1);
        expect(hidden, `the other spelling should not be drawn at ${w.name}`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("a toggle says which app and which person it is", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/admin");
    await expect(page.getByTestId("staff-table")).toBeVisible();

    for (const c of COLUMNS) {
      await expect(
        page.getByTestId(`toggle-${OTHER.email}-${c.flag}`),
        `${c.flag} should name its app and its person`,
      ).toHaveAccessibleName(`${c.label} for ${OTHER.name}`);
    }

    // "on"/"off" is what is drawn, not part of the name — aria-pressed carries
    // the state, and "Invoices for Nora Noflags off" is what it sounds like
    // when that slips.
    await expect(
      page.getByTestId(`toggle-${OTHER.email}-hasInvoices`),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId(`toggle-${OTHER.email}-active`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Your own Admin and Active are disabled, which takes them out of the tab
    // order and out of the reach of a tooltip. The name has to say why.
    await expect(
      page.getByTestId("toggle-everything@example.test-isAdmin"),
    ).toHaveAccessibleName("Admin for Ada Everything — cannot be changed for yourself");
    await expect(
      page.getByTestId("toggle-everything@example.test-active"),
    ).toHaveAccessibleName("Active for Ada Everything — cannot be changed for yourself");
  });

  test("a row header names the person once, for every toggle in the row", async ({
    page,
  }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/admin");

    const header = page
      .getByTestId(`row-${OTHER.email}`)
      .getByRole("rowheader");
    await expect(header).toHaveCount(1);
    await expect(header).toContainText(OTHER.name);
    await expect(header).toContainText(OTHER.email);
  });

  test("the keyboard walks a row left to right", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/admin");
    await expect(page.getByTestId("staff-table")).toBeVisible();

    await page.getByTestId(`toggle-${OTHER.email}-${COLUMNS[0].flag}`).focus();
    for (const c of COLUMNS.slice(1)) {
      await page.keyboard.press("Tab");
      await expect(
        page.getByTestId(`toggle-${OTHER.email}-${c.flag}`),
        `Tab should land on ${c.flag} next`,
      ).toBeFocused();
    }

    // And off the end of the row onto the next person's first toggle, rather
    // than into one of the three hidden inputs every one of these forms carries.
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveJSProperty("tagName", "BUTTON");
  });
});

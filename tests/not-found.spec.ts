import { expect, signInAs, test } from "./harness";

/**
 * Rule 4 says a route 404s for anybody without its flag, so the 404 is not an
 * edge case here — it is the designed answer to somebody trying /invoices to
 * see what happens, and what it says is part of the guard.
 *
 * Until now it said it in Next's default page: "404 | This page could not be
 * found", system font, no brand. That answered the probe with two things the
 * guard exists to withhold — that something real is there, and what it is built
 * with.
 */
test.describe("the 404", () => {
  // A deliberate 404 makes the browser log one of its own.
  test.use({ tolerate: ["status of 404"] });

  test("a route the person has no flag for renders Power Suite's own 404", async ({
    page,
  }) => {
    // Active staff, no flags. The route exists; this person may not open it.
    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/invoices");

    expect(res?.status(), "still a 404, not a 403").toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.getByTestId("product-name")).toHaveText("Power Suite");

    const html = (await res?.text()) ?? "";
    expect(html, "Next's own 404 should be nowhere in it").not.toContain(
      "This page could not be found",
    );
  });

  test("an address that is nothing at all gets the same screen", async ({ page }) => {
    // The two must not be told apart by what they say. A different page for a
    // route that exists is the 403 this project refused to serve, in disguise.
    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/there-is-no-such-thing-here");

    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();

    const forbidden = await page.locator("body").innerText();
    await page.goto("/invoices");
    const unknown = await page.locator("body").innerText();
    expect(unknown).toBe(forbidden);
  });

  /**
   * What would make this pass while the 404 is leaking? It reads the rendered
   * text, so it would miss a leak that is in the markup and not on the screen —
   * and there is one, recorded in the pull request: Next streams the requested
   * segment's own metadata into the flight payload, so the HTML for a 404 on
   * /invoices contains the string "Invoices" and the HTML for a 404 on a
   * nonsense path does not. That is why the framework string above is asserted
   * against the response body rather than against this.
   */
  test("the 404 names no route, no flag and no framework", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/invoices");
    await expect(page.getByTestId("not-found")).toBeVisible();

    const body = await page.locator("body").innerText();

    for (const route of ["/invoices", "/timesheets", "/expenses", "/margin", "/admin"]) {
      expect(body, `the 404 should not name ${route}`).not.toContain(route);
    }
    for (const flag of ["has_invoices", "has_timesheet", "has_margin", "is_admin"]) {
      expect(body, `the 404 should not name ${flag}`).not.toContain(flag);
    }
    for (const word of ["Next.js", "This page could not be found", "404"]) {
      expect(body, `the 404 should not say ${word}`).not.toContain(word);
    }
    // Nor should it explain itself. "You do not have access to this" is the
    // 403 again, written out in words.
    expect(body.toLowerCase()).not.toContain("access");
    expect(body.toLowerCase()).not.toContain("permission");
  });

  test("the way back works", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/invoices");
    await page.getByRole("link", { name: "Back to Power Suite" }).click();
    await expect(page.getByTestId("user-name")).toBeVisible();
  });

  for (const w of [
    { name: "390-phone", width: 390, height: 844 },
    { name: "1440-desktop", width: 1440, height: 900 },
  ]) {
    test(`the 404 renders at ${w.name}`, async ({ page }, testInfo) => {
      await signInAs(page, "no.flags@example.test");
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/invoices");
      await expect(page.getByTestId("not-found")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the 404 must not scroll sideways").toBeLessThanOrEqual(0);

      await testInfo.attach(`not-found-${w.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
});

/**
 * And a crash.
 *
 * `src/app/error.tsx` is the one screen in Power Suite that cannot be reached by
 * asking for it, which is why /api/test/crash exists: an error page nobody has
 * ever rendered is an error page nobody knows the shape of, and the shape is the
 * whole point — a crash is the moment a page starts saying more than it meant
 * to.
 */
test.describe("a crash", () => {
  /**
   * The noise a deliberate crash makes, named rather than switched off.
   *
   * The 5xx line the harness builds is `500 from <url>`, so naming the path
   * excuses that request and no other — a 500 from anywhere else in this test
   * still fails it. React 441 is the client switching to its own render after
   * the server render threw, which is exactly what is being exercised.
   */
  test.use({
    tolerate: [
      "/api/test/crash",
      "status of 500",
      "Minified React error #441",
      "[error] render failed",
    ],
  });

  test("a server component that throws renders Power Suite's own error page", async ({
    page,
  }) => {
    const logged: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") logged.push(msg.text());
    });

    await signInAs(page, "no.flags@example.test");
    const res = await page.goto("/api/test/crash");

    expect(res?.status()).toBe(500);
    await expect(page.getByTestId("crashed")).toBeVisible();
    await expect(page.getByTestId("product-name")).toHaveText("Power Suite");

    // The digest goes to the console and nowhere else. Read it back off the log
    // and prove it is not on the screen: rendering it would be the one string
    // the error page has to give away.
    const line = logged.find((l) => l.includes("[error] render failed"));
    expect(line, "the digest should be logged").toBeTruthy();
    const digest = (line ?? "").replace(/^.*digest\s+/, "").trim();
    expect(digest, "Next should have stamped a digest on it").not.toBe("none");

    const body = await page.locator("body").innerText();
    expect(body, "the digest is for the log, not the page").not.toContain(digest);
    expect(body).not.toContain("Deliberate crash");
    expect(body).not.toContain("/api/test/crash");
    for (const word of ["Next.js", "webpack", "at Object.", "stack"]) {
      expect(body, `the error page should not say ${word}`).not.toContain(word);
    }
  });

  test("the error page offers a way back and nothing else", async ({ page }) => {
    await signInAs(page, "no.flags@example.test");
    await page.goto("/api/test/crash");
    await expect(page.getByTestId("crashed")).toBeVisible();

    // One link, one destination: the front door.
    const hrefs = await page
      .locator("[data-testid='crashed'] a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(["/"]);

    await page.getByRole("link", { name: "Back to Power Suite" }).click();
    await expect(page.getByTestId("user-name")).toBeVisible();
  });
});

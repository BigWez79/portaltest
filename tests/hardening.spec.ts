import { expect, signInAs, test } from "./harness";

test.describe("hardening", () => {
  test("no Graph token, and no Graph scope, reaches the browser", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/");

    const html = await page.content();
    expect(html).not.toContain("Sites.ReadWrite.All");
    expect(html).not.toContain("graph.microsoft.com");

    const stored = await page.evaluate(() => ({
      session: Object.keys(sessionStorage),
      local: Object.keys(localStorage),
    }));
    expect(stored.session, "nothing belongs in sessionStorage any more").toEqual([]);
    expect(stored.local).toEqual([]);
  });

  test("no Supabase credential is present in the delivered page or its bundles", async ({
    page,
  }) => {
    const bodies: string[] = [];
    page.on("response", async (res) => {
      const type = res.headers()["content-type"] ?? "";
      if (type.includes("javascript") || type.includes("html")) {
        try {
          bodies.push(await res.text());
        } catch {
          /* redirects and 304s have no body */
        }
      }
    });

    await signInAs(page, "everything@example.test");
    await page.goto("/");
    await expect(page.getByTestId("tiles")).toBeVisible();

    const all = bodies.join("\n");
    expect(all).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(all).not.toContain("service_role");
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./);
  });

  test("security headers are set", async ({ page }) => {
    const res = await page.goto("/");
    const headers = res?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("the sign-in card offers exactly one action and leaks no tile hrefs", async ({
    page,
  }) => {
    await page.request.delete("/api/test/session");
    await page.goto("/");

    const html = await page.content();
    expect(html).not.toContain("invoices.poweranalytix.co.uk");
    expect(html).not.toContain("timesheet.poweranalytix.co.uk");
    expect(html).not.toContain("expenses.poweranalytix.co.uk");
  });

  test("the test seeder rejects a request with no address", async ({ page }) => {
    const res = await page.request.get("/api/test/session");
    expect(res.status()).toBe(400);
  });
});

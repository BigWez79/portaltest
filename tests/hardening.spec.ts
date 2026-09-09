import { expect, signInAs, signOutCompletely, test } from "./harness";

test.describe("hardening", () => {
  test("no Supabase key of any kind reaches the browser", async ({ page }) => {
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
    expect(all).not.toContain("SUPABASE_ANON_KEY");
    expect(all).not.toContain("service_role");
    // A JWT-shaped string is what both Supabase keys look like.
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./);
  });

  test("nothing is kept in browser storage", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/");

    const stored = await page.evaluate(() => ({
      session: Object.keys(sessionStorage),
      local: Object.keys(localStorage),
    }));
    expect(stored.session, "the session lives in an httpOnly cookie").toEqual([]);
    expect(stored.local).toEqual([]);
  });

  test("security headers are set", async ({ page }) => {
    const res = await page.goto("/");
    const headers = res?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("the sign-in card leaks no app routes", async ({ page }) => {
    await signOutCompletely(page);
    await page.goto("/");

    const hrefs = await page.locator("a[href]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href")),
    );
    for (const route of ["/invoices", "/timesheets", "/expenses", "/admin"]) {
      expect(hrefs, `a signed-out page should not link to ${route}`).not.toContain(route);
    }
  });

  test("asking for a link says the same thing whoever you are", async ({ page }) => {
    // Different answers for a known and an unknown address turn the sign-in form
    // into a directory of who works here.
    await signOutCompletely(page);
    await page.goto("/");
    await page.getByTestId("email").fill("everything@example.test");
    await page.getByTestId("signin").click();
    const known = await page.getByTestId("link-sent").textContent();

    await page.goto("/");
    await page.getByTestId("email").fill("nobody@example.test");
    await page.getByTestId("signin").click();
    const unknown = await page.getByTestId("link-sent").textContent();

    expect(unknown).toBe(known);
  });

  test("a bad magic link is turned away", async ({ page }) => {
    await signOutCompletely(page);
    await page.goto("/auth/callback?token_hash=nonsense&type=email");
    await expect(page.getByTestId("signin-error")).toBeVisible();
    await expect(page.getByTestId("login-view")).toBeVisible();
  });

  test("the callback will not redirect off-site", async ({ page }) => {
    await signOutCompletely(page);
    await page.goto("/auth/callback?token_hash=x&next=https://example.com/evil");
    expect(new URL(page.url()).host).toBe(new URL(page.url()).host);
    expect(page.url()).not.toContain("example.com");
  });

  test("the Sign out button really does end the session", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/");
    await page.getByTestId("signout").click();

    await expect(page.getByTestId("login-view")).toBeVisible();
    // Not merely a redirect to the front door: the cookie has to be gone, or
    // the next request signs them straight back in.
    await page.goto("/");
    await expect(page.getByTestId("login-view")).toBeVisible();
  });

  /**
   * The one part of ending a session the suite can check against Supabase's own
   * cookie names. Everything else on that path — auth.signOut({ scope: "global" })
   * revoking the refresh tokens — needs a live project and is not exercised
   * here; see TASKS.md.
   *
   * @supabase/ssr names the session cookie from the project ref and splits it
   * into .0/.1 chunks when the token is long, so both shapes are planted.
   */
  test("signing out clears a Supabase session cookie, chunks and all", async ({ page }) => {
    await signInAs(page, "everything@example.test");
    await page.goto("/");

    const url = new URL(page.url()).origin;
    await page.context().addCookies([
      { name: "sb-abcdefgh-auth-token", value: "planted", url },
      { name: "sb-abcdefgh-auth-token.0", value: "planted", url },
      { name: "sb-abcdefgh-auth-token.1", value: "planted", url },
    ]);

    await page.goto("/auth/signed-out");
    await expect(page.getByTestId("login-view")).toBeVisible();

    const left = (await page.context().cookies()).map((c) => c.name);
    expect(left.filter((n) => n.startsWith("sb-"))).toEqual([]);
    expect(left).not.toContain("e2e-session");
  });

  test("the test seeder rejects a request with no address", async ({ page }) => {
    const res = await page.request.get("/api/test/session");
    expect(res.status()).toBe(400);
  });
});

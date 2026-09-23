import { expect, signInAs, signOutCompletely, test } from "./harness";

/** `a 'b'; c 'd' 'e'` -> `{ a: ["'b'"], c: ["'d'", "'e'"] }` */
function directives(header: string | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of (header ?? "").split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = sources;
  }
  return out;
}

function nonceOf(header: string | undefined): string | undefined {
  return (directives(header)["script-src"] ?? [])
    .find((s) => s.startsWith("'nonce-"))
    ?.slice("'nonce-".length, -1);
}

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
    expect(headers["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    expect(headers["content-security-policy"]).toBeTruthy();
    // Strict-Transport-Security is Vercel's, and it is already correct there:
    // max-age=63072000; includeSubDomains; preload. Nothing asserts it here on
    // purpose — the suite runs over http on 127.0.0.1, where no browser sends
    // HSTS and no server should, so a check here could only ever pass by being
    // written to accept its absence. That is not a check.
  });

  test("the policy says what it is meant to say", async ({ page }) => {
    const res = await page.goto("/");
    const csp = directives(res?.headers()["content-security-policy"]);

    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
    expect(csp["font-src"]).toEqual(["'self'"]);
    // `data:` is allowed for one named reason — the profile logo, which is a
    // data URL by the time it is stored — and the assertion is written as the
    // exact set so adding a second source is a decision somebody has to come
    // here and make, rather than something that slips in.
    expect(csp["img-src"]).toEqual(["'self'", "data:"]);

    // The point of the whole exercise. A CSP that allows inline script is a
    // header that is present, asserted, and stopping nothing — Next writes
    // inline bootstrap scripts, and the answer to them is a nonce, not a hole.
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    expect(csp["script-src"]?.some((s) => s.startsWith("'nonce-"))).toBeTruthy();
    // Nothing off this origin may be loaded, so nothing on the page can reach
    // out. `'strict-dynamic'` is what lets the nonced bootstrap pull its chunks.
    for (const source of csp["script-src"] ?? []) {
      expect(source).not.toMatch(/^https?:/);
    }
  });

  test("a fresh nonce on every request, stamped on every script", async ({ page }) => {
    await signInAs(page, "everything@example.test");

    // Read the served HTML rather than the DOM: a browser blanks the `nonce`
    // attribute once it has read it, so the DOM cannot answer this question.
    const served = await page.request.get("/");
    const nonce = nonceOf(served.headers()["content-security-policy"]);
    expect(nonce, "the policy should carry a nonce").toBeTruthy();

    // The nonce has to be the one on the tags, or the header is breaking the
    // page rather than protecting it. The harness would catch the console
    // errors that follow; this says which end of it went wrong.
    const tags = (await served.text()).match(/<script\b[^>]*>/g) ?? [];
    expect(tags.length, "the page should carry script tags").toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag, "every script tag should carry the request's nonce").toContain(
        `nonce="${nonce}"`,
      );
    }

    // A nonce reused between requests is a password somebody can read off the
    // last page they were served, which is not a nonce.
    const again = await page.request.get("/");
    expect(nonceOf(again.headers()["content-security-policy"])).not.toBe(nonce);
  });

  test("everything carries the policy, not only what renders", async ({ page }) => {
    // The proxy issues the nonced policy, and its matcher skips the chunks, the
    // fonts and the logo for the obvious reason. Those responses still answer a
    // direct request, so next.config.ts puts the nonce-free policy under them.
    const res = await page.goto("/");
    expect(res?.headers()["content-security-policy"]).toBeTruthy();

    const chunk = await page
      .locator("script[src]")
      .first()
      .getAttribute("src");
    expect(chunk, "the page should load at least one chunk").toBeTruthy();

    for (const path of [chunk!, "/logo.png"]) {
      const asset = await page.request.get(path);
      const csp = directives(asset.headers()["content-security-policy"]);
      expect(csp["default-src"], `${path} should carry a policy`).toEqual(["'self'"]);
      expect(csp["script-src"]).toEqual(["'self'"]);
    }
  });

  test("a 404 and a redirect carry the policy too", async ({ page }) => {
    // A 404 is the designed answer to a route somebody may not open, and the
    // redirect is what a signed-out request gets. Neither renders much, and a
    // policy that covers only the happy path covers only the uninteresting one.
    await signInAs(page, "no.flags@example.test");
    const missing = await page.request.get("/admin");
    expect(missing.status()).toBe(404);
    expect(missing.headers()["content-security-policy"]).toBeTruthy();

    await signOutCompletely(page);
    const bounced = await page.request.get("/admin", { maxRedirects: 0 });
    expect(bounced.status()).toBe(307);
    expect(bounced.headers()["content-security-policy"]).toBeTruthy();
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

  test("the test seeder rejects a request with no address", async ({ page }) => {
    const res = await page.request.get("/api/test/session");
    expect(res.status()).toBe(400);
  });
});

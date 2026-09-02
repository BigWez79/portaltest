import { askForLink, expect, linkLedger, signOutCompletely, test } from "./harness";

/**
 * The sign-in form will send a link every time the button is pressed. These
 * check that it stops, and — just as important — that it does not say so.
 *
 * The page cannot tell an allowed request from a refused one, by design, so
 * each test reads `/api/test/rate-limit` afterwards for the decision the action
 * actually took. That endpoint is a 404 outside E2E_TEST_MODE.
 *
 * Serial, and each test owns its address and its IP: two of these running
 * beside each other would count each other's requests. The IP arrives as
 * `x-forwarded-for`, which is what a deployed portal reads.
 *
 * One thing this cannot check at 3am is that the first five emails land in an
 * inbox — the suite reaches no Supabase project and sends nothing. What it
 * checks is the decision to send, taken at the point the real code calls
 * `signInWithOtp`.
 */
test.describe.serial("sign-in rate limit", () => {
  test("a sixth link for one address inside a minute is refused, silently", async ({
    page,
  }) => {
    const flooded = "flood.one@example.test";
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.11" });
    await signOutCompletely(page);

    const answers: string[] = [];
    for (let i = 0; i < 6; i++) {
      answers.push(await askForLink(page, flooded));
    }

    // The sixth was turned away and said exactly what the first five said.
    expect(new Set(answers).size, "every answer should read the same").toBe(1);

    const ledger = await linkLedger(page, { email: flooded });
    expect(ledger.allowed, "the first five should have been sent").toBe(5);
    expect(ledger.refused, "the sixth should have been refused").toBe(1);

    // An address nobody has asked for, from the same network: it is not caught
    // by the first address's limit, and it is told the same thing again — the
    // answer a stranger gets and the answer a flooded address gets match.
    const stranger = "nobody.here@example.test";
    const strangerAnswer = await askForLink(page, stranger);
    expect(strangerAnswer).toBe(answers[5]);

    const strangerLedger = await linkLedger(page, { email: stranger });
    expect(strangerLedger.allowed, "one address's limit is not another's").toBe(1);
    expect(strangerLedger.refused).toBe(0);
  });

  test("one network cannot ask for links on address after address", async ({ page }) => {
    // Twenty-one trips through the form, at about two seconds each. The default
    // timeout is not enough and the limit is not worth lowering to fit it: staff
    // behind one office NAT share an IP, and a refusal here is silent.
    test.slow();

    // Twenty in fifteen minutes, so four addresses at their own limit of five
    // use the network's allowance up between them. The twenty-first is refused
    // on a fresh address that has asked for nothing.
    const ip = "203.0.113.12";
    await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    await signOutCompletely(page);

    for (const name of ["ip.a", "ip.b", "ip.c", "ip.d"]) {
      for (let i = 0; i < 5; i++) {
        await askForLink(page, `${name}@example.test`);
      }
    }

    const before = await linkLedger(page, { ip });
    expect(before.allowed, "four addresses at five links each").toBe(20);
    expect(before.refused, "none of those should have been refused").toBe(0);

    const fresh = "ip.e@example.test";
    await askForLink(page, fresh);

    const freshLedger = await linkLedger(page, { email: fresh });
    expect(freshLedger.allowed, "the network is out of allowance").toBe(0);
    expect(freshLedger.refused).toBe(1);

    const after = await linkLedger(page, { ip });
    expect(after.allowed).toBe(20);
    expect(after.refused).toBe(1);
  });

  test("the ledger route rejects a request that names nothing", async ({ page }) => {
    const res = await page.request.get("/api/test/rate-limit");
    expect(res.status()).toBe(400);
  });
});

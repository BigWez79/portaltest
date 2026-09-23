import { deflateSync } from "node:zlib";
import { expect, resetStores, signInAs, test } from "./harness";

/**
 * My Profile — the only app with no flag. Every active staff member has it
 * (CLAUDE.md rule 10), and what it holds is what Invoices stamps onto a
 * document a customer reads.
 */

/**
 * The whole file runs in one worker, in order.
 *
 * `test.describe.serial` orders the tests *inside* one block; it says nothing
 * about two blocks running beside each other, and this file has two that both
 * reset the profile store and both write to the same fixture person. They
 * interleaved: the logo block's reset landed between the sort-code test's save
 * and its reload, and the field came back empty. It failed as a sort-code bug,
 * which is the second time this shape of thing has been found here.
 *
 * One line, at file level, because the constraint is the file's: these tests
 * share one row in one file on disk.
 */
test.describe.configure({ mode: "serial" });

const STAFF = "timesheet.only@example.test";
const COMPLETE = "invoices.only@example.test";
const PARTIAL = "everything@example.test";
const NO_FLAGS = "no.flags@example.test";

/* -------------------------------------------------------------------------
   Pictures to choose

   Written here rather than checked in as fixture files so the size of each one
   is a number this test states. The encoder is deliberately dumb — no filtering
   and one IDAT — because the point is to produce a real PNG for the file
   picker, not a small one.
   ------------------------------------------------------------------------- */

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number, noise = false): Buffer {
  // A fixed seed: a test that passes because of the numbers it happened to draw
  // is not a test. This is the same picture every run.
  let seed = 0x2545f491;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % 256;
  };

  const raw = Buffer.alloc(height * (1 + width * 4));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      if (noise) {
        raw[at++] = random();
        raw[at++] = random();
        raw[at++] = random();
      } else {
        raw[at++] = 0x50;
        raw[at++] = 0x7d;
        raw[at++] = 0xe5;
      }
      raw[at++] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10, 11, 12 stay zero: deflate, no filtering, no interlace.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Choose a picture the way a person does — through the file input itself. */
async function chooseLogo(
  page: import("@playwright/test").Page,
  opts: { width: number; height: number; noise?: boolean },
) {
  await page.getByTestId("logo-file").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: png(opts.width, opts.height, opts.noise),
  });
}

test.describe("profile — reading", () => {
  test("a complete profile says so", async ({ page }) => {
    await signInAs(page, COMPLETE);
    await page.goto("/profile");

    await expect(page.getByTestId("profile-app")).toBeVisible();
    await expect(page.getByTestId("invoice-readiness")).toContainText("Ready to invoice");
    await expect(page.getByTestId("business-name")).toHaveValue("Invoices Only Ltd");
  });

  test("the sort code is shown grouped, however it was stored", async ({ page }) => {
    await signInAs(page, COMPLETE);
    await page.goto("/profile");

    // Stored as six digits; displayed the way somebody would read it aloud.
    await expect(page.getByTestId("sort-code")).toHaveValue("20-45-67");
  });

  test("an incomplete profile names what an invoice would be missing", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await expect(page.getByTestId("invoice-readiness")).toContainText("would be incomplete");
    await expect(page.getByTestId("missing-sort-code")).toBeVisible();
    await expect(page.getByTestId("missing-account-number")).toBeVisible();
    await expect(page.getByTestId("missing-business-address")).toBeVisible();
  });

  test("somebody with no app flags still has this page", async ({ page }) => {
    await signInAs(page, NO_FLAGS);
    const res = await page.goto("/profile");

    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("profile-app")).toBeVisible();
  });

  test("the VAT number is only offered when the business is registered", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await expect(page.getByTestId("vat-number")).toHaveCount(0);
    await page.getByTestId("vat-registered").selectOption("yes");
    await expect(page.getByTestId("vat-number")).toBeVisible();
  });
});

test.describe.serial("profile — writing", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "profiles");
  });

  test("filling in what was missing turns the page green", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await page.getByTestId("business-address").fill("9 Foundry Row, Derby DE1 1AB");
    await page.getByTestId("account-name").fill("Everything Consulting");
    await page.getByTestId("sort-code").fill("30 99 12");
    await page.getByTestId("account-no").fill("87654321");
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-ok")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("invoice-readiness")).toContainText("Ready to invoice");
  });

  test("a sort code is accepted however it is typed, and stored one way", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await page.getByTestId("sort-code").fill("30-99-12");
    await page.getByTestId("account-no").fill("8765 4321");
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-ok")).toBeVisible({ timeout: 15000 });

    await page.reload();
    await expect(page.getByTestId("sort-code")).toHaveValue("30-99-12");
    await expect(page.getByTestId("account-no")).toHaveValue("87654321");
  });

  test("a half-typed sort code is refused rather than stored", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await page.getByTestId("sort-code").fill("3099");
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-error")).toContainText("six digits", { timeout: 15000 });
  });

  test("a VAT number without the registration is refused", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    // Turning registration off removes the VAT box, so this form cannot post
    // the pair — which is the right behaviour and also means the server check
    // is never reached from here. Put the field back and post anyway, as
    // anything other than this form would: the constraint refuses it, and an
    // invoice printing a VAT number it should not is a correction letter.
    await page.getByTestId("profile-form").evaluate((form) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "vatNumber";
      input.value = "GB999999999";
      form.appendChild(input);
    });
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-error")).toContainText("VAT", { timeout: 15000 });
  });
});

test.describe.serial("profile — the logo", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "profiles");
  });

  test("no logo says so, rather than showing a broken picture", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await expect(page.getByTestId("logo-empty")).toBeVisible();
    await expect(page.getByTestId("logo-preview")).toHaveCount(0);
    await expect(page.getByTestId("logo-remove")).toHaveCount(0);
    await expect(page.getByTestId("logo-value")).toHaveValue("");
  });

  test("a chosen logo previews, saves, and is still there on the next visit", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await chooseLogo(page, { width: 600, height: 200 });

    await expect(page.getByTestId("logo-preview")).toBeVisible();
    await expect(page.getByTestId("logo-empty")).toHaveCount(0);

    // Resized on the way in: 600px wide becomes 300, which is what gets stored.
    const width = await page
      .getByTestId("logo-value")
      .evaluate(
        (el) =>
          new Promise<number>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img.width);
            img.src = (el as HTMLInputElement).value;
          }),
      );
    expect(width, "the picture is scaled to 300px wide before it is stored").toBe(300);

    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-ok")).toBeVisible({ timeout: 15000 });

    await page.goto("/profile");
    await expect(page.getByTestId("logo-preview")).toBeVisible();
    await expect(page.getByTestId("logo-value")).not.toHaveValue("");
  });

  test("removing the logo sticks", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    await chooseLogo(page, { width: 400, height: 120 });
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-ok")).toBeVisible({ timeout: 15000 });

    await page.goto("/profile");
    await page.getByTestId("logo-remove").click();
    await expect(page.getByTestId("logo-empty")).toBeVisible();

    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-ok")).toBeVisible({ timeout: 15000 });

    await page.goto("/profile");
    await expect(page.getByTestId("logo-empty")).toBeVisible();
    await expect(page.getByTestId("logo-value")).toHaveValue("");
  });

  test("a picture too detailed to store is refused where somebody can fix it", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    // Noise at this size does not compress, so the PNG stays far over the limit
    // even after being scaled to 300px wide.
    await chooseLogo(page, { width: 600, height: 600, noise: true });

    await expect(page.getByTestId("logo-problem")).toContainText("too detailed", {
      timeout: 15000,
    });
    // Refused means nothing was kept, not "kept but complained about".
    await expect(page.getByTestId("logo-value")).toHaveValue("");
    await expect(page.getByTestId("logo-empty")).toBeVisible();
  });

  test("the server refuses a logo that did not come from the form", async ({ page }) => {
    await signInAs(page, PARTIAL);
    await page.goto("/profile");

    // The picker and the canvas are a convenience; the action is a public
    // endpoint (rule 5). An SVG data URL is the one that matters — it is a
    // script, and it would run inside the img tag on an invoice.
    await page.getByTestId("logo-value").evaluate((el) => {
      (el as HTMLInputElement).value =
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
    });
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-error")).toContainText("PNG", { timeout: 15000 });
  });
});

/**
 * The day rate is on the profile but saved from two screens — My Profile and
 * Timesheets, because that is where somebody is standing when they think about
 * what a day is worth. These tests live here rather than in timesheets.spec.ts
 * because they write to the profiles store, which this file owns and resets.
 */
test.describe("profile — the day rate", () => {
  test.beforeEach(async ({ page }) => {
    await resetStores(page, "profiles");
  });

  test("a day rate saved here shows up on My Profile", async ({ page }) => {
    await signInAs(page, STAFF);
    await page.goto("/timesheets");

    await page.getByTestId("ts-day-rate").fill("450");
    await page.getByTestId("save-day-rate").click();
    await expect(page.getByTestId("rate-ok")).toBeVisible({ timeout: 15000 });

    // One column, two ways in. A second copy would be two answers to "what do
    // you charge" with nothing saying which one an invoice used.
    await page.goto("/profile");
    await expect(page.getByTestId("day-rate")).toHaveValue("450");
  });

  test("saving a day rate does not blank the rest of the profile", async ({ page }) => {
    await signInAs(page, STAFF);

    // The action reads the profile, changes one field and writes it back. If it
    // wrote only the rate it would blank somebody's bank details, which is the
    // worst thing in this schema to lose quietly.
    await page.goto("/profile");
    await page.getByTestId("business-name").fill("Tessa Timesheets Ltd");
    await page.getByTestId("sort-code").fill("40-11-22");
    await page.getByTestId("account-no").fill("11223344");
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-ok")).toBeVisible({ timeout: 15000 });

    await page.goto("/timesheets");
    await page.getByTestId("ts-day-rate").fill("525");
    await page.getByTestId("save-day-rate").click();
    await expect(page.getByTestId("rate-ok")).toBeVisible({ timeout: 15000 });

    await page.goto("/profile");
    await expect(page.getByTestId("business-name")).toHaveValue("Tessa Timesheets Ltd");
    await expect(page.getByTestId("sort-code")).toHaveValue("40-11-22");
    await expect(page.getByTestId("account-no")).toHaveValue("11223344");
    await expect(page.getByTestId("day-rate")).toHaveValue("525");
  });
});

test.describe("profile — layout", () => {
  for (const width of [390, 1440]) {
    test(`the form fits at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(page, COMPLETE);
      await page.goto("/profile");

      await expect(page.getByTestId("profile-app")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
    });
  }
});

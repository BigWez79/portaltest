import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * The suite runs against a production build, in test mode, reading staff rows
 * from tests/fixtures/staff.json. It never reaches Entra, Graph or Supabase —
 * so it runs identically on the Mac Studio at 02:00 and on a laptop.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Only set on machines that already have a Chromium and cannot run
          // `npx playwright install` (sandboxed CI images). Unset everywhere else.
          executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
          args: process.env.E2E_NO_SANDBOX ? ["--no-sandbox"] : [],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      E2E_TEST_MODE: "1",
      STAFF_SOURCE: "fixture",
      BOOTSTRAP_ADMINS: "",
      // Auth.js is constructed at import time; these are never used because the
      // suite never signs in through Entra, but they have to be present.
      AUTH_SECRET: "e2e-only-not-a-real-secret",
      AUTH_MICROSOFT_ENTRA_ID_ID: "e2e-client-id",
      AUTH_MICROSOFT_ENTRA_ID_SECRET: "e2e-client-secret",
      ENTRA_TENANT_ID: "00000000-0000-0000-0000-000000000000",
    },
  },
});

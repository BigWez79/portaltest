/**
 * Every environment variable the portal reads, in one place.
 *
 * Nothing here is prefixed NEXT_PUBLIC_. That is deliberate: Next.js inlines any
 * NEXT_PUBLIC_* variable into the client bundle, and one of these is a Supabase
 * service-role key. `npm run check:secrets` fails the build if that ever changes.
 *
 * Reads are lazy so that `next build` does not need production credentials.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const isTestMode = () => process.env.E2E_TEST_MODE === "1";

/** "supabase" in every real environment; "fixture" only under the e2e suite. */
export const staffSource = () =>
  (optional("STAFF_SOURCE", "supabase") as "supabase" | "fixture");

export const entra = {
  get tenantId() {
    return required("ENTRA_TENANT_ID");
  },
  /**
   * Pinned to the tenant on purpose. Auth.js defaults this to
   * https://login.microsoftonline.com/common/v2.0, which lets any Microsoft
   * account on earth begin a sign-in. See tests/tenant-pinning.spec.ts.
   */
  get issuer() {
    return `https://login.microsoftonline.com/${required("ENTRA_TENANT_ID")}/v2.0`;
  },
};

export const supabase = {
  get url() {
    return required("SUPABASE_URL");
  },
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
};

/**
 * Fallback allow-list carried over from portal v2.0. A bootstrap admin sees
 * every tile even with no staff row, so the portal can never lock its own
 * administrator out while the staff table is empty or mid-sync.
 */
export const bootstrapAdmins = (): string[] =>
  optional("BOOTSTRAP_ADMINS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Every environment variable the portal reads, in one place.
 *
 * Nothing here is prefixed NEXT_PUBLIC_, and nothing needs to be: the portal
 * talks to Supabase only from the server. No Supabase key of any kind — not even
 * the anon key — is sent to a browser. `npm run check:secrets` reads the built
 * output and fails if that ever changes.
 *
 * Reads are lazy so `next build` does not need production credentials.
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

export const supabase = {
  get url() {
    return required("SUPABASE_URL");
  },
  /** Public by design, but still kept server-side. RLS is what protects the data. */
  get anonKey() {
    return required("SUPABASE_ANON_KEY");
  },
  /** Invites and the import script only. Never used to read staff rows. */
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
};

/** Absolute origin, needed to build magic-link callback URLs. */
export const siteUrl = () => {
  const explicit = optional("SITE_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = optional("VERCEL_URL");
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
};

export const resend = {
  get apiKey() {
    return optional("RESEND_API_KEY");
  },
  get from() {
    return optional("RESEND_FROM", "Power Analytix <no-reply@poweranalytix.co.uk>");
  },
  get enabled() {
    return optional("RESEND_API_KEY") !== "";
  },
};

/**
 * Fallback allow-list. A bootstrap admin sees every tile and can reach the admin
 * screen even with no staff row, so the portal can never lock its own
 * administrator out — during the import, or after a bad flag edit.
 */
export const bootstrapAdmins = (): string[] =>
  optional("BOOTSTRAP_ADMINS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

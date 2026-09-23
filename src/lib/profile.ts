import "server-only";
import { staffSource } from "./env";
import { EMPTY_PROFILE, toProfile, type Profile, type ProfileInput } from "./profile-calc";

/**
 * My Profile — the business details a person invoices under.
 *
 * Read through the caller's own session, so row level security decides what
 * comes back (0007_profiles.sql). Every active staff member has this screen and
 * there is no flag for it (CLAUDE.md rule 10).
 *
 * The shapes and the tidying are in profile-calc.ts, which the browser may
 * import. This file may not be.
 */

export * from "./profile-calc";

const COLUMNS =
  "staff_email, business_name, business_type, business_address, company_number, vat_registered, vat_number, account_name, sort_code, account_no, issuer_prefix, payment_terms_days, contact_email, contact_phone, tagline, logo, day_rate";

const fixture = () => staffSource() === "fixture";

async function store() {
  const { profileStore } = await import("./profile-store");
  return profileStore;
}

/**
 * Somebody who has never opened this page has no row. That is not an error and
 * not something to create on a read — an empty profile is returned instead, so
 * the page renders a blank form rather than a failure.
 */
export async function getProfile(email: string): Promise<Profile> {
  const key = email.toLowerCase();
  if (!key) return { ...EMPTY_PROFILE };
  if (fixture()) return (await store()).get(key);

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();
  const { data, error } = await client.from("profiles").select(COLUMNS).limit(1);

  if (error) {
    console.error("[profile] read failed", error.message);
    return { ...EMPTY_PROFILE, staffEmail: key };
  }
  const row = data?.[0] as Record<string, unknown> | undefined;
  return row ? toProfile(row) : { ...EMPTY_PROFILE, staffEmail: key };
}

export async function saveProfile(email: string, input: ProfileInput): Promise<boolean> {
  const key = email.toLowerCase();
  if (fixture()) return (await store()).save(key, input);

  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  // Upsert rather than insert-or-update: the first save of a profile and every
  // save after it are the same action to a person, and making the application
  // decide which it is means one more thing to get wrong.
  const { error } = await client.from("profiles").upsert(
    {
      staff_email: key,
      business_name: input.businessName,
      business_type: input.businessType,
      business_address: input.businessAddress,
      company_number: input.companyNumber,
      vat_registered: input.vatRegistered,
      vat_number: input.vatNumber,
      account_name: input.accountName,
      sort_code: input.sortCode,
      account_no: input.accountNo,
      issuer_prefix: input.issuerPrefix,
      payment_terms_days: input.paymentTermsDays,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone,
      tagline: input.tagline,
      logo: input.logo,
      day_rate: input.dayRate,
    },
    { onConflict: "staff_email" },
  );

  if (error) {
    console.error("[profile] save failed", error.message);
    return false;
  }
  return true;
}

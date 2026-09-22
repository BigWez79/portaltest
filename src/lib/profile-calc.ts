/**
 * My Profile — the shapes and the tidying, with no server in them.
 *
 * Split from profile.ts so the browser can format a sort code as somebody
 * types. profile.ts is `server-only`.
 */

export type Profile = {
  staffEmail: string;
  businessName: string | null;
  businessType: string | null;
  businessAddress: string | null;
  companyNumber: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  accountName: string | null;
  sortCode: string | null;
  accountNo: string | null;
  issuerPrefix: string | null;
  paymentTermsDays: number;
  contactEmail: string | null;
  contactPhone: string | null;
  tagline: string | null;
};

export const BUSINESS_TYPES = [
  "Limited company",
  "Sole trader",
  "Partnership",
  "LLP",
  "Other",
] as const;

export const EMPTY_PROFILE: Profile = {
  staffEmail: "",
  businessName: null,
  businessType: null,
  businessAddress: null,
  companyNumber: null,
  vatRegistered: false,
  vatNumber: null,
  accountName: null,
  sortCode: null,
  accountNo: null,
  issuerPrefix: null,
  paymentTermsDays: 30,
  contactEmail: null,
  contactPhone: null,
  tagline: null,
};

/* -------------------------------------------------------------------------
   Bank details
   ------------------------------------------------------------------------- */

/**
 * Six digits, however it was typed. The live page stores whatever is in the
 * box, so the same sort code arrives as "20-00-00", "200000" or "20 00 00" and
 * an invoice prints whichever version that person happened to use.
 */
export function normaliseSortCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}

export function normaliseAccountNo(input: string): string {
  return input.replace(/\D/g, "").slice(0, 8);
}

/** 200000 -> 20-00-00. Display only; the stored value stays six digits. */
export function formatSortCode(code: string | null): string {
  if (!code) return "";
  const d = code.replace(/\D/g, "");
  if (d.length !== 6) return code;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
}

/* -------------------------------------------------------------------------
   Completeness
   ------------------------------------------------------------------------- */

export type Missing = { field: string; why: string };

/**
 * What an invoice would be missing if it were raised right now.
 *
 * The live suite lets an invoice go out with blank seller details and nobody
 * finds out until a customer asks where to pay. This is the list the profile
 * page shows, and it is the same list whether or not anybody looks at it.
 */
export function missingForInvoicing(p: Profile): Missing[] {
  const out: Missing[] = [];
  if (!p.businessName) out.push({ field: "Business name", why: "printed at the top of every invoice" });
  if (!p.businessAddress) out.push({ field: "Business address", why: "an invoice needs the address it came from" });
  if (!p.accountName) out.push({ field: "Account name", why: "a customer needs to know who they are paying" });
  if (!p.sortCode) out.push({ field: "Sort code", why: "without it nobody can pay the invoice" });
  if (!p.accountNo) out.push({ field: "Account number", why: "without it nobody can pay the invoice" });
  if (p.vatRegistered && !p.vatNumber) {
    out.push({ field: "VAT number", why: "you are charging VAT, so the number has to appear" });
  }
  return out;
}

export const isInvoiceReady = (p: Profile) => missingForInvoicing(p).length === 0;

export function toProfile(row: Record<string, unknown>): Profile {
  return {
    staffEmail: String(row.staff_email ?? "").toLowerCase(),
    businessName: (row.business_name as string) ?? null,
    businessType: (row.business_type as string) ?? null,
    businessAddress: (row.business_address as string) ?? null,
    companyNumber: (row.company_number as string) ?? null,
    vatRegistered: Boolean(row.vat_registered),
    vatNumber: (row.vat_number as string) ?? null,
    accountName: (row.account_name as string) ?? null,
    sortCode: (row.sort_code as string) ?? null,
    accountNo: (row.account_no as string) ?? null,
    issuerPrefix: (row.issuer_prefix as string) ?? null,
    paymentTermsDays: Number(row.payment_terms_days ?? 30),
    contactEmail: (row.contact_email as string) ?? null,
    contactPhone: (row.contact_phone as string) ?? null,
    tagline: (row.tagline as string) ?? null,
  };
}

export type ProfileInput = Omit<Profile, "staffEmail">;

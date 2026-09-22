/**
 * Invoices — the shapes and the arithmetic, with no server in them.
 *
 * Split from invoices.ts because the browser needs both to total an invoice as
 * somebody types, and invoices.ts is `server-only`: importing it from a client
 * component drags the Supabase client into the browser bundle, which is what
 * `npm run check:secrets` exists to stop.
 */

export type Customer = {
  id: string;
  companyName: string;
  contactName: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
};

export type InvoiceStatus = "Draft" | "Sent" | "Paid";

export type InvoiceLine = {
  id: string;
  invoiceId: string;
  itemNo: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  tax: number;
  lineTotal: number;
  position: number;
};

export type Invoice = {
  id: string;
  sellerEmail: string;
  invoiceNo: string;
  issuerPrefix: string | null;
  invoiceSeq: number | null;
  customerId: string;
  invoiceDate: string;
  project: string | null;
  taxRate: number;
  unitTotal: number;
  taxTotal: number;
  invoiceTotal: number;
  status: InvoiceStatus;
  paidDate: string | null;
  sellerName: string | null;
  sellerAddress: string | null;
  sellerVat: string | null;
  sellerCompanyNo: string | null;
  sellerBankName: string | null;
  sellerSortCode: string | null;
  sellerAccountNo: string | null;
};

export const STATUSES: InvoiceStatus[] = ["Draft", "Sent", "Paid"];

export const DEFAULT_TAX_RATE = 20;

/* -------------------------------------------------------------------------
   Money
   ------------------------------------------------------------------------- */

/**
 * Two places, half-up. Every figure on an invoice is rounded at the point it is
 * calculated rather than at the point it is displayed, so the lines a customer
 * adds up by hand come to the total printed at the bottom.
 */
export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * The live page accepts a rate as either 20 or 0.2 and divides by 100 when the
 * number is above 1 — which makes 0.5 mean half a percent and 20 mean twenty.
 * One shape here: a percentage, always. This is the function that enforces it.
 */
export function normaliseRate(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TAX_RATE;
  return n > 100 ? 100 : n;
}

export function lineAmounts(
  qty: number,
  unitPrice: number,
  ratePercent: number,
): { net: number; tax: number; total: number } {
  const net = round2(Number(qty) * Number(unitPrice));
  const tax = round2(net * (normaliseRate(ratePercent) / 100));
  return { net, tax, total: round2(net + tax) };
}

/**
 * An invoice's totals are the sum of its lines, never a figure held on its own.
 * Rounded per line first, then summed — summing raw products and rounding once
 * gives a total that does not match the printed lines, by a penny, on about one
 * invoice in twenty.
 */
export function invoiceTotals(lines: InvoiceLine[]): {
  unitTotal: number;
  taxTotal: number;
  invoiceTotal: number;
} {
  const unitTotal = round2(lines.reduce((sum, l) => sum + round2(l.qty * l.unitPrice), 0));
  const taxTotal = round2(lines.reduce((sum, l) => sum + l.tax, 0));
  return { unitTotal, taxTotal, invoiceTotal: round2(unitTotal + taxTotal) };
}

/* -------------------------------------------------------------------------
   Invoice numbers
   ------------------------------------------------------------------------- */

/** "PA-0007" -> { prefix: "PA", seq: 7 }. Anything else has no sequence. */
export function splitInvoiceNo(no: string): { prefix: string | null; seq: number | null } {
  const m = /^([A-Za-z0-9]+)-(\d+)$/.exec(no.trim());
  if (!m) return { prefix: null, seq: null };
  return { prefix: m[1].toUpperCase(), seq: Number(m[2]) };
}

/**
 * The next number for a prefix, padded to the width already in use. Somebody
 * who started at INV-0001 keeps four digits; somebody who started at INV-1 does
 * not suddenly get INV-0002.
 */
export function nextInvoiceNo(existing: string[], prefix: string): string {
  const p = prefix.toUpperCase();
  let highest = 0;
  let width = 4;
  for (const no of existing) {
    const { prefix: got, seq } = splitInvoiceNo(no);
    if (got !== p || seq == null) continue;
    if (seq > highest) highest = seq;
    const digits = no.trim().split("-")[1]?.length ?? 4;
    if (digits > width) width = digits;
  }
  return `${p}-${String(highest + 1).padStart(width, "0")}`;
}

export const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

/* -------------------------------------------------------------------------
   Row mapping
   ------------------------------------------------------------------------- */

export function toCustomer(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    companyName: String(row.company_name ?? ""),
    contactName: (row.contact_name as string) ?? null,
    address1: (row.address1 as string) ?? null,
    address2: (row.address2 as string) ?? null,
    town: (row.town as string) ?? null,
    postcode: (row.postcode as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
  };
}

export function toLine(row: Record<string, unknown>): InvoiceLine {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    itemNo: (row.item_no as string) ?? null,
    description: String(row.description ?? ""),
    qty: Number(row.qty ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    tax: Number(row.tax ?? 0),
    lineTotal: Number(row.line_total ?? 0),
    position: Number(row.position ?? 0),
  };
}

export function toInvoice(row: Record<string, unknown>): Invoice {
  return {
    id: String(row.id),
    sellerEmail: String(row.seller_email ?? "").toLowerCase(),
    invoiceNo: String(row.invoice_no ?? ""),
    issuerPrefix: (row.issuer_prefix as string) ?? null,
    invoiceSeq: row.invoice_seq == null ? null : Number(row.invoice_seq),
    customerId: String(row.customer_id ?? ""),
    invoiceDate: String(row.invoice_date ?? ""),
    project: (row.project as string) ?? null,
    taxRate: Number(row.tax_rate ?? DEFAULT_TAX_RATE),
    unitTotal: Number(row.unit_total ?? 0),
    taxTotal: Number(row.tax_total ?? 0),
    invoiceTotal: Number(row.invoice_total ?? 0),
    status: (String(row.status ?? "Draft") as InvoiceStatus),
    paidDate: (row.paid_date as string) ?? null,
    sellerName: (row.seller_name as string) ?? null,
    sellerAddress: (row.seller_address as string) ?? null,
    sellerVat: (row.seller_vat as string) ?? null,
    sellerCompanyNo: (row.seller_company_no as string) ?? null,
    sellerBankName: (row.seller_bank_name as string) ?? null,
    sellerSortCode: (row.seller_sort_code as string) ?? null,
    sellerAccountNo: (row.seller_account_no as string) ?? null,
  };
}

export type CustomerInput = {
  companyName: string;
  contactName: string;
  address1: string;
  address2: string;
  town: string;
  postcode: string;
  phone: string;
  email: string;
};

export type InvoiceInput = {
  invoiceNo: string;
  customerId: string;
  invoiceDate: string;
  project: string;
  taxRate: number;
};

export type LineInput = {
  itemNo: string;
  description: string;
  qty: number;
  unitPrice: number;
};

import "server-only";
import { staffSource } from "./env";
import {
  invoiceTotals,
  lineAmounts,
  splitInvoiceNo,
  toCustomer,
  toInvoice,
  toLine,
  type Customer,
  type CustomerInput,
  type Invoice,
  type InvoiceInput,
  type InvoiceLine,
  type InvoiceStatus,
  type LineInput,
} from "./invoices-calc";

/**
 * Invoices — customers, headers, lines, and the totals that follow from them.
 *
 * Reads go through the caller's own session, so row level security decides what
 * comes back (CLAUDE.md rule 11, and 0005_invoices.sql). There is no `.eq()` on
 * seller_email anywhere in the read path: a filter written here would read like
 * the thing keeping other people's invoices out, and the next person to touch
 * it would believe that.
 *
 * The shapes and the arithmetic are in invoices-calc.ts, which the browser may
 * import. This file may not be.
 */

export * from "./invoices-calc";

const CUSTOMER_COLS =
  "id, company_name, contact_name, address1, address2, town, postcode, phone, email";
const INVOICE_COLS =
  "id, seller_email, invoice_no, issuer_prefix, invoice_seq, customer_id, invoice_date, project, tax_rate, unit_total, tax_total, invoice_total, status, paid_date, seller_name, seller_address, seller_vat, seller_company_no, seller_bank_name, seller_sort_code, seller_account_no";
const LINE_COLS =
  "id, invoice_id, item_no, description, qty, unit_price, tax, line_total, position";

async function store() {
  const { invoiceStore } = await import("./invoices-store");
  return invoiceStore;
}

async function client() {
  const { supabaseServer } = await import("./supabase/server");
  return supabaseServer();
}

const fixture = () => staffSource() === "fixture";

/* -------------------------------------------------------------------------
   Reads
   ------------------------------------------------------------------------- */

export async function listCustomers(): Promise<Customer[]> {
  if (fixture()) return (await store()).customers();

  const { data, error } = await (await client())
    .from("customers")
    .select(CUSTOMER_COLS)
    .order("company_name");
  if (error) {
    console.error("[invoices] customers failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => toCustomer(r as Record<string, unknown>));
}

export async function listInvoices(email: string): Promise<Invoice[]> {
  const key = email.toLowerCase();
  if (!key) return [];
  if (fixture()) return (await store()).invoicesFor(key);

  const { data, error } = await (await client())
    .from("invoices")
    .select(INVOICE_COLS)
    .order("invoice_date", { ascending: false });
  if (error) {
    console.error("[invoices] list failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => toInvoice(r as Record<string, unknown>));
}

export async function listLines(invoiceId: string): Promise<InvoiceLine[]> {
  if (fixture()) return (await store()).linesFor(invoiceId);

  const { data, error } = await (await client())
    .from("invoice_lines")
    .select(LINE_COLS)
    .eq("invoice_id", invoiceId)
    .order("position");
  if (error) {
    console.error("[invoices] lines failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => toLine(r as Record<string, unknown>));
}

/* -------------------------------------------------------------------------
   Writes
   ------------------------------------------------------------------------- */

export async function addCustomer(input: CustomerInput): Promise<boolean> {
  if (fixture()) return (await store()).addCustomer(input);

  const { error } = await (await client()).from("customers").insert({
    company_name: input.companyName,
    contact_name: input.contactName || null,
    address1: input.address1 || null,
    address2: input.address2 || null,
    town: input.town || null,
    postcode: input.postcode || null,
    phone: input.phone || null,
    email: input.email || null,
  });
  if (error) {
    console.error("[invoices] add customer failed", error.message);
    return false;
  }
  return true;
}

/** The seller's own details, copied onto the invoice as they stand today. */
export type SellerStamp = {
  name: string | null;
  address: string | null;
  vat: string | null;
  companyNo: string | null;
  bankName: string | null;
  sortCode: string | null;
  accountNo: string | null;
};

export async function createInvoice(
  email: string,
  input: InvoiceInput,
  seller: SellerStamp,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const key = email.toLowerCase();
  const { prefix, seq } = splitInvoiceNo(input.invoiceNo);

  if (fixture()) return (await store()).createInvoice(key, input, seller, prefix, seq);

  const { data, error } = await (await client())
    .from("invoices")
    .insert({
      seller_email: key,
      invoice_no: input.invoiceNo,
      issuer_prefix: prefix,
      invoice_seq: seq,
      customer_id: input.customerId,
      invoice_date: input.invoiceDate,
      project: input.project || null,
      tax_rate: input.taxRate,
      seller_name: seller.name,
      seller_address: seller.address,
      seller_vat: seller.vat,
      seller_company_no: seller.companyNo,
      seller_bank_name: seller.bankName,
      seller_sort_code: seller.sortCode,
      seller_account_no: seller.accountNo,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[invoices] create failed", error.message);
    // The unique constraint is per seller, so this is always "you already have
    // one with that number" rather than "somebody else does".
    if (error.code === "23505") {
      return { ok: false, message: `You already have an invoice numbered ${input.invoiceNo}.` };
    }
    return { ok: false, message: "That invoice could not be created." };
  }
  return { ok: true, id: String((data as Record<string, unknown>).id) };
}

export async function addLine(
  invoiceId: string,
  input: LineInput,
  ratePercent: number,
  position: number,
): Promise<boolean> {
  const { tax, total } = lineAmounts(input.qty, input.unitPrice, ratePercent);

  if (fixture()) return (await store()).addLine(invoiceId, input, tax, total, position);

  const { error } = await (await client()).from("invoice_lines").insert({
    invoice_id: invoiceId,
    item_no: input.itemNo || null,
    description: input.description,
    qty: input.qty,
    unit_price: input.unitPrice,
    tax,
    line_total: total,
    position,
  });
  if (error) {
    console.error("[invoices] add line failed", error.message);
    return false;
  }
  return syncTotals(invoiceId);
}

export async function removeLine(lineId: string, invoiceId: string): Promise<boolean> {
  if (fixture()) return (await store()).removeLine(lineId, invoiceId);

  const { error } = await (await client()).from("invoice_lines").delete().eq("id", lineId);
  if (error) {
    console.error("[invoices] remove line failed", error.message);
    return false;
  }
  return syncTotals(invoiceId);
}

/**
 * Recalculate the header from the lines and write it back.
 *
 * Called after every line change. The totals are never typed and never trusted
 * from the browser — they are what the lines add up to, worked out here.
 */
export async function syncTotals(invoiceId: string): Promise<boolean> {
  const lines = await listLines(invoiceId);
  const totals = invoiceTotals(lines);

  if (fixture()) return (await store()).setTotals(invoiceId, totals);

  const { error } = await (await client())
    .from("invoices")
    .update({
      unit_total: totals.unitTotal,
      tax_total: totals.taxTotal,
      invoice_total: totals.invoiceTotal,
    })
    .eq("id", invoiceId);
  if (error) {
    console.error("[invoices] totals failed", error.message);
    return false;
  }
  return true;
}

export async function setStatus(
  invoiceId: string,
  status: InvoiceStatus,
): Promise<boolean> {
  // Paid needs a date: the check constraint refuses the row without one, and a
  // paid invoice with no payment date is a question somebody has to answer by
  // email six months later.
  const paidDate = status === "Paid" ? new Date().toISOString().slice(0, 10) : null;

  if (fixture()) return (await store()).setStatus(invoiceId, status, paidDate);

  const { error } = await (await client())
    .from("invoices")
    .update({ status, paid_date: paidDate })
    .eq("id", invoiceId);
  if (error) {
    console.error("[invoices] status failed", error.message);
    return false;
  }
  return true;
}

export async function deleteDraft(invoiceId: string): Promise<boolean> {
  if (fixture()) return (await store()).deleteDraft(invoiceId);

  const { error } = await (await client()).from("invoices").delete().eq("id", invoiceId);
  if (error) {
    console.error("[invoices] delete failed", error.message);
    return false;
  }
  return true;
}

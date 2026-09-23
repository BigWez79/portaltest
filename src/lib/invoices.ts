import "server-only";
import { staffSource } from "./env";
import {
  invoiceTotals,
  lineAmounts,
  normaliseRate,
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
  "id, seller_email, invoice_no, issuer_prefix, invoice_seq, customer_id, invoice_date, project, tax_rate, unit_total, tax_total, invoice_total, status, paid_date, seller_name, seller_address, seller_vat, seller_company_no, seller_bank_name, seller_sort_code, seller_account_no, seller_tagline, seller_logo, payment_terms_days";
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
  tagline: string | null;
  logo: string | null;
  /** Stamped, not read live — see 0009_invoice_document.sql for why. */
  paymentTermsDays: number | null;
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
      seller_tagline: seller.tagline,
      seller_logo: seller.logo,
      payment_terms_days: seller.paymentTermsDays,
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

/* -------------------------------------------------------------------------
   Correcting what is already there
   ------------------------------------------------------------------------- */

/**
 * Change an invoice's header after it has been raised.
 *
 * Not the totals: those are what the lines add up to and are never typed. If
 * the VAT rate moves, every line is re-priced from it and the header follows —
 * a rate on the header that disagrees with the tax on the lines is a document
 * that does not add up, which is the one thing an invoice must never be.
 */
export async function updateInvoiceHeader(
  invoiceId: string,
  input: InvoiceInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const rate = normaliseRate(input.taxRate);

  if (fixture()) {
    const done = await (await store()).updateHeader(invoiceId, { ...input, taxRate: rate });
    if (!done) return { ok: false, message: "That invoice could not be changed." };
  } else {
    const { prefix, seq } = splitInvoiceNo(input.invoiceNo);
    const { error } = await (await client())
      .from("invoices")
      .update({
        invoice_no: input.invoiceNo,
        issuer_prefix: prefix,
        invoice_seq: seq,
        customer_id: input.customerId,
        invoice_date: input.invoiceDate,
        project: input.project || null,
        tax_rate: rate,
      })
      .eq("id", invoiceId);
    if (error) {
      // The unique constraint is per seller, so this is always "you already
      // have one with that number" rather than somebody else's collision.
      if (error.code === "23505") {
        return { ok: false, message: `You already have an invoice numbered ${input.invoiceNo}.` };
      }
      console.error("[invoices] header update failed", error.message);
      return { ok: false, message: "That invoice could not be changed." };
    }
  }

  const repriced = await repriceLines(invoiceId, rate);
  return repriced ? { ok: true } : { ok: false, message: "The lines could not be re-priced." };
}

/** Put every line back through `lineAmounts` at the invoice's current rate. */
export async function repriceLines(invoiceId: string, ratePercent: number): Promise<boolean> {
  const lines = await listLines(invoiceId);

  for (const line of lines) {
    const { tax, total } = lineAmounts(line.qty, line.unitPrice, ratePercent);
    if (tax === line.tax && total === line.lineTotal) continue;

    if (fixture()) {
      await (await store()).setLineAmounts(line.id, tax, total);
    } else {
      const { error } = await (await client())
        .from("invoice_lines")
        .update({ tax, line_total: total })
        .eq("id", line.id);
      if (error) {
        console.error("[invoices] reprice failed", error.message);
        return false;
      }
    }
  }
  return syncTotals(invoiceId);
}

/**
 * Delete an invoice, unless it has been paid.
 *
 * A DEPARTURE, AND THE REASON. `invoices.html` deletes any of them. A paid
 * invoice is a settled record — the customer has it, the money moved against
 * it, and the year it belongs to gets filed. Deleting one leaves a payment with
 * nothing to point at, and the gap is silent: nothing on any screen says a
 * number was used once and is now missing.
 *
 * Draft and Sent can still go, which is what somebody actually reaches for —
 * the wrong customer, a number typed twice, an invoice raised in error before
 * anybody paid it. If a paid one genuinely has to be undone, marking it unpaid
 * first is a deliberate act that leaves the invoice there to be looked at.
 */
export async function deleteInvoice(
  invoiceId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (fixture()) {
    const done = await (await store()).deleteInvoice(invoiceId);
    return done
      ? { ok: true }
      : { ok: false, message: "A paid invoice cannot be deleted. Mark it unpaid first." };
  }

  const { error } = await (await client())
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .neq("status", "Paid");
  if (error) {
    console.error("[invoices] delete failed", error.message);
    return { ok: false, message: "That invoice could not be deleted." };
  }
  return { ok: true };
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<boolean> {
  if (fixture()) return (await store()).updateCustomer(id, input);

  const { error } = await (await client())
    .from("customers")
    .update({
      company_name: input.companyName,
      contact_name: input.contactName || null,
      address1: input.address1 || null,
      address2: input.address2 || null,
      town: input.town || null,
      postcode: input.postcode || null,
      phone: input.phone || null,
      email: input.email || null,
    })
    .eq("id", id);
  if (error) {
    console.error("[invoices] customer update failed", error.message);
    return false;
  }
  return true;
}

/**
 * Remove a customer, unless an invoice points at them.
 *
 * The invoice keeps the customer's details only by reference — `Bill To` is
 * read from this row at render time, not stamped like the seller's half. So
 * deleting a customer with invoices would blank the address on every document
 * they were ever sent.
 */
export async function deleteCustomer(
  id: string,
  email: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invoices = await listInvoices(email);
  const used = invoices.filter((i) => i.customerId === id).length;
  if (used > 0) {
    return {
      ok: false,
      message: `That customer is on ${used} invoice${used === 1 ? "" : "s"}, so removing them would blank the address on ${used === 1 ? "it" : "them"}.`,
    };
  }

  if (fixture()) {
    const done = await (await store()).deleteCustomer(id);
    return done ? { ok: true } : { ok: false, message: "That customer could not be removed." };
  }

  const { error } = await (await client()).from("customers").delete().eq("id", id);
  if (error) {
    console.error("[invoices] customer delete failed", error.message);
    return { ok: false, message: "That customer could not be removed." };
  }
  return { ok: true };
}

/**
 * Everybody's invoices, for an admin.
 *
 * The same query as `listInvoices` — the policy in 0005 is what decides whether
 * more than one seller's rows come back (rule 11). A separate function so the
 * caller has to say out loud that it expects other people's documents, which is
 * the same shape as `listAllExpenses`.
 *
 * The caller must have checked `isAdmin`. In fixture mode there is no policy to
 * lean on and that check is the only thing standing here.
 */
export async function listAllInvoices(): Promise<Invoice[]> {
  if (fixture()) return (await store()).allInvoices();

  const { data, error } = await (await client())
    .from("invoices")
    .select(INVOICE_COLS)
    .order("invoice_date", { ascending: false });
  if (error) {
    console.error("[invoices] list all failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => toInvoice(row as Record<string, unknown>));
}

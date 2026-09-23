import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
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
import type { SellerStamp } from "./invoices";

/**
 * Test-only invoice store, so the suite can exercise the write path without a
 * live Supabase. Same shape as the staff and expenses stores: seeded from
 * tests/fixtures into .tmp so a test that raises an invoice does not edit a
 * tracked file, saved by rename so parallel workers never read half a document,
 * and named with a random suffix because Next instantiates a module more than
 * once per process.
 *
 * Reachable only when STAFF_SOURCE=fixture.
 *
 * It enforces the rules the policies enforce — a paid invoice cannot be edited,
 * only a draft can be deleted — and deliberately duplicates them. A suite that
 * passed against a store which let a paid invoice be rewritten would prove
 * nothing about the table that refuses it.
 */

type Doc = { customers: Customer[]; invoices: Invoice[]; lines: InvoiceLine[] };

const SEED = path.join(process.cwd(), "tests", "fixtures", "invoices.json");
const WORKING = path.join(process.cwd(), ".tmp", "invoices.json");

function normalise(raw: unknown): Doc {
  const d = (raw ?? {}) as Record<string, unknown>;
  const map = <T>(rows: unknown, camelKey: string, fn: (r: Record<string, unknown>) => T): T[] =>
    ((rows as unknown[]) ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      // The seed is written in the database's spelling; the working copy is
      // written in the application's. Mapping a working copy a second time
      // looks for snake_case keys that are no longer there and yields a row
      // belonging to nobody.
      return camelKey in row ? (row as unknown as T) : fn(row);
    });

  return {
    customers: map(d.customers, "companyName", toCustomer),
    invoices: map(d.invoices, "sellerEmail", toInvoice),
    lines: map(d.lines, "invoiceId", toLine),
  };
}

async function load(): Promise<Doc> {
  try {
    const [seedStat, workingStat] = await Promise.all([stat(SEED), stat(WORKING)]);
    if (seedStat.mtimeMs > workingStat.mtimeMs) throw new Error("seed is newer");
    return normalise(JSON.parse(await readFile(WORKING, "utf8")));
  } catch {
    const seed = normalise(JSON.parse(await readFile(SEED, "utf8")));
    await save(seed);
    return seed;
  }
}

async function save(doc: Doc): Promise<void> {
  await mkdir(path.dirname(WORKING), { recursive: true });
  const pending = `${WORKING}.${randomUUID()}.tmp`;
  await writeFile(pending, JSON.stringify(doc, null, 2), "utf8");
  await rename(pending, WORKING);
}

const find = (doc: Doc, id: string) => doc.invoices.find((i) => i.id === id);

export const invoiceStore = {
  async customers(): Promise<Customer[]> {
    const doc = await load();
    return [...doc.customers].sort((a, b) => a.companyName.localeCompare(b.companyName));
  },

  async invoicesFor(email: string): Promise<Invoice[]> {
    const doc = await load();
    return doc.invoices
      .filter((i) => i.sellerEmail === email)
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  },

  /** Everybody's, for an admin. The caller checks that; this does not. */
  async allInvoices(): Promise<Invoice[]> {
    const doc = await load();
    return [...doc.invoices].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  },

  async linesFor(invoiceId: string): Promise<InvoiceLine[]> {
    const doc = await load();
    return doc.lines
      .filter((l) => l.invoiceId === invoiceId)
      .sort((a, b) => a.position - b.position);
  },

  async addCustomer(input: CustomerInput): Promise<boolean> {
    const doc = await load();
    doc.customers.push({
      id: randomUUID(),
      companyName: input.companyName,
      contactName: input.contactName || null,
      address1: input.address1 || null,
      address2: input.address2 || null,
      town: input.town || null,
      postcode: input.postcode || null,
      phone: input.phone || null,
      email: input.email || null,
    });
    await save(doc);
    return true;
  },

  async createInvoice(
    email: string,
    input: InvoiceInput,
    seller: SellerStamp,
    prefix: string | null,
    seq: number | null,
  ): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    const doc = await load();
    const clash = doc.invoices.some(
      (i) => i.sellerEmail === email && i.invoiceNo.toLowerCase() === input.invoiceNo.toLowerCase(),
    );
    if (clash) {
      return { ok: false, message: `You already have an invoice numbered ${input.invoiceNo}.` };
    }

    const row: Invoice = {
      id: randomUUID(),
      sellerEmail: email,
      invoiceNo: input.invoiceNo,
      issuerPrefix: prefix,
      invoiceSeq: seq,
      customerId: input.customerId,
      invoiceDate: input.invoiceDate,
      project: input.project || null,
      taxRate: input.taxRate,
      unitTotal: 0,
      taxTotal: 0,
      invoiceTotal: 0,
      status: "Draft",
      paidDate: null,
      sellerName: seller.name,
      sellerAddress: seller.address,
      sellerVat: seller.vat,
      sellerCompanyNo: seller.companyNo,
      sellerBankName: seller.bankName,
      sellerSortCode: seller.sortCode,
      sellerAccountNo: seller.accountNo,
      sellerTagline: seller.tagline,
      sellerLogo: seller.logo,
      paymentTermsDays: seller.paymentTermsDays,
    };
    doc.invoices.push(row);
    await save(doc);
    return { ok: true, id: row.id };
  },

  async addLine(
    invoiceId: string,
    input: LineInput,
    tax: number,
    total: number,
    position: number,
  ): Promise<boolean> {
    const doc = await load();
    const inv = find(doc, invoiceId);
    if (!inv || inv.status === "Paid") return false;

    doc.lines.push({
      id: randomUUID(),
      invoiceId,
      itemNo: input.itemNo || null,
      description: input.description,
      qty: input.qty,
      unitPrice: input.unitPrice,
      tax,
      lineTotal: total,
      position,
    });
    await save(doc);
    return true;
  },

  async removeLine(lineId: string, invoiceId: string): Promise<boolean> {
    const doc = await load();
    const inv = find(doc, invoiceId);
    if (!inv || inv.status === "Paid") return false;
    doc.lines = doc.lines.filter((l) => l.id !== lineId);
    await save(doc);
    return true;
  },

  async setTotals(
    invoiceId: string,
    totals: { unitTotal: number; taxTotal: number; invoiceTotal: number },
  ): Promise<boolean> {
    const doc = await load();
    const inv = find(doc, invoiceId);
    if (!inv) return false;
    Object.assign(inv, totals);
    await save(doc);
    return true;
  },

  async setStatus(
    invoiceId: string,
    status: InvoiceStatus,
    paidDate: string | null,
  ): Promise<boolean> {
    const doc = await load();
    const inv = find(doc, invoiceId);
    if (!inv) return false;
    inv.status = status;
    inv.paidDate = paidDate;
    await save(doc);
    return true;
  },

  async updateHeader(invoiceId: string, input: InvoiceInput): Promise<boolean> {
    const doc = await load();
    const inv = find(doc, invoiceId);
    if (!inv) return false;
    // A number already used by this seller on another invoice is the one
    // collision worth refusing here; the database has a unique index saying so.
    const clash = doc.invoices.some(
      (i) =>
        i.id !== invoiceId &&
        i.sellerEmail === inv.sellerEmail &&
        i.invoiceNo === input.invoiceNo,
    );
    if (clash) return false;

    const { prefix, seq } = splitInvoiceNo(input.invoiceNo);
    inv.invoiceNo = input.invoiceNo;
    inv.issuerPrefix = prefix;
    inv.invoiceSeq = seq;
    inv.customerId = input.customerId;
    inv.invoiceDate = input.invoiceDate;
    inv.project = input.project || null;
    inv.taxRate = input.taxRate;
    await save(doc);
    return true;
  },

  async setLineAmounts(lineId: string, tax: number, total: number): Promise<boolean> {
    const doc = await load();
    const line = doc.lines.find((l) => l.id === lineId);
    if (!line) return false;
    line.tax = tax;
    line.lineTotal = total;
    await save(doc);
    return true;
  },

  async deleteInvoice(invoiceId: string): Promise<boolean> {
    const doc = await load();
    const inv = find(doc, invoiceId);
    if (!inv || inv.status === "Paid") return false;
    doc.invoices = doc.invoices.filter((i) => i.id !== invoiceId);
    doc.lines = doc.lines.filter((l) => l.invoiceId !== invoiceId);
    await save(doc);
    return true;
  },

  async updateCustomer(id: string, input: CustomerInput): Promise<boolean> {
    const doc = await load();
    const at = doc.customers.findIndex((c) => c.id === id);
    if (at === -1) return false;
    doc.customers[at] = { ...doc.customers[at], ...input };
    await save(doc);
    return true;
  },

  async deleteCustomer(id: string): Promise<boolean> {
    const doc = await load();
    const before = doc.customers.length;
    doc.customers = doc.customers.filter((c) => c.id !== id);
    if (doc.customers.length === before) return false;
    await save(doc);
    return true;
  },

  async deleteDraft(invoiceId: string): Promise<boolean> {
    const doc = await load();
    const inv = find(doc, invoiceId);
    if (!inv || inv.status !== "Draft") return false;
    doc.invoices = doc.invoices.filter((i) => i.id !== invoiceId);
    doc.lines = doc.lines.filter((l) => l.invoiceId !== invoiceId);
    await save(doc);
    return true;
  },

  /** Back to the seed. The suite calls this between write tests. */
  async reset(): Promise<void> {
    await save(normalise(JSON.parse(await readFile(SEED, "utf8"))));
  },
};

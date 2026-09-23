"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import {
  STATUSES,
  addCustomer,
  addLine,
  createInvoice,
  deleteDraft,
  listInvoices,
  listLines,
  normaliseRate,
  removeLine,
  setStatus,
  syncTotals,
  type InvoiceStatus,
} from "@/lib/invoices";
import { getProfile } from "@/lib/profile";
import { resolveAccess } from "@/lib/staff";

export type InvoiceState = { status: "idle" | "ok" | "error"; message?: string };

/**
 * Every action re-checks the caller. A server action is a public endpoint —
 * rendering the form is not what stops somebody without the flag posting to it
 * (CLAUDE.md rule 5). The route's requireApp guard protects the page, not this.
 */
async function requireInvoices() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const access = await resolveAccess(user);
  if (!access.apps.invoices) throw new Error("No invoices access");
  return access;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INVOICE_NO = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;

export async function saveCustomer(
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  try {
    await requireInvoices();
  } catch {
    return { status: "error", message: "You are not allowed to add customers." };
  }

  const companyName = String(formData.get("companyName") ?? "").trim();
  if (!companyName) return { status: "error", message: "A customer needs a name." };

  const ok = await addCustomer({
    companyName,
    contactName: String(formData.get("contactName") ?? "").trim(),
    address1: String(formData.get("address1") ?? "").trim(),
    address2: String(formData.get("address2") ?? "").trim(),
    town: String(formData.get("town") ?? "").trim(),
    postcode: String(formData.get("postcode") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
  });
  if (!ok) return { status: "error", message: "That customer could not be saved." };

  revalidatePath("/invoices");
  return { status: "ok", message: `${companyName} added.` };
}

export async function raiseInvoice(
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  let access;
  try {
    access = await requireInvoices();
  } catch {
    return { status: "error", message: "You are not allowed to raise invoices." };
  }

  const invoiceNo = String(formData.get("invoiceNo") ?? "").trim();
  const customerId = String(formData.get("customerId") ?? "");
  const invoiceDate = String(formData.get("invoiceDate") ?? "").trim();

  if (!INVOICE_NO.test(invoiceNo)) {
    return { status: "error", message: "An invoice number is letters, numbers and dashes." };
  }
  if (!customerId) return { status: "error", message: "Choose a customer." };
  if (!DATE.test(invoiceDate)) return { status: "error", message: "Choose an invoice date." };

  // The seller's details are copied onto the invoice as they stand today, so
  // the document keeps saying what the customer was sent even after somebody
  // changes their business address. They come from My Profile, which is where
  // a person maintains them; falling back to the display name means somebody
  // who has never opened that screen still gets an invoice with a name on it.
  const profile = await getProfile(access.email);
  const result = await createInvoice(
    access.email,
    {
      invoiceNo,
      customerId,
      invoiceDate,
      project: String(formData.get("project") ?? "").trim(),
      taxRate: normaliseRate(formData.get("taxRate")),
    },
    {
      name: profile.businessName || access.displayName || null,
      address: profile.businessAddress,
      // A VAT number is only printed when the business says it is registered.
      // The profile's own constraint stops the pair disagreeing, but an invoice
      // is the document that would carry the mistake to a customer.
      vat: profile.vatRegistered ? profile.vatNumber : null,
      companyNo: profile.companyNumber,
      bankName: profile.accountName,
      sortCode: profile.sortCode,
      accountNo: profile.accountNo,
      tagline: profile.tagline,
      logo: profile.logo,
      paymentTermsDays: profile.paymentTermsDays,
    },
  );

  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/invoices");
  return { status: "ok", message: `${invoiceNo} created. Add its lines below.` };
}

export async function addInvoiceLine(
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  let access;
  try {
    access = await requireInvoices();
  } catch {
    return { status: "error", message: "You are not allowed to change invoices." };
  }

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const qty = Number(formData.get("qty"));
  const unitPrice = Number(formData.get("unitPrice"));

  if (!description) return { status: "error", message: "Describe the line." };
  if (!Number.isFinite(qty) || qty <= 0) return { status: "error", message: "Enter a quantity." };
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { status: "error", message: "Enter a unit price." };
  }

  // The rate comes off the invoice, never off the form — a line is charged at
  // the rate the invoice carries, not at whatever a browser posts.
  const mine = await listInvoices(access.email);
  const invoice = mine.find((i) => i.id === invoiceId);
  if (!invoice) return { status: "error", message: "That invoice is not yours." };
  if (invoice.status === "Paid") {
    return { status: "error", message: "That invoice is paid and can no longer be changed." };
  }

  const existing = await listLines(invoiceId);
  const ok = await addLine(
    invoiceId,
    { itemNo: String(formData.get("itemNo") ?? "").trim(), description, qty, unitPrice },
    invoice.taxRate,
    existing.length,
  );
  if (!ok) return { status: "error", message: "That line could not be added." };

  await syncTotals(invoiceId);
  revalidatePath("/invoices");
  return { status: "ok", message: "Line added." };
}

export async function removeInvoiceLine(
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  let access;
  try {
    access = await requireInvoices();
  } catch {
    return { status: "error", message: "You are not allowed to change invoices." };
  }

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");

  const mine = await listInvoices(access.email);
  const invoice = mine.find((i) => i.id === invoiceId);
  if (!invoice) return { status: "error", message: "That invoice is not yours." };
  if (invoice.status === "Paid") {
    return { status: "error", message: "That invoice is paid and can no longer be changed." };
  }

  const ok = await removeLine(lineId, invoiceId);
  if (!ok) return { status: "error", message: "That line could not be removed." };

  await syncTotals(invoiceId);
  revalidatePath("/invoices");
  return { status: "ok", message: "Line removed." };
}

export async function markInvoice(
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  let access;
  try {
    access = await requireInvoices();
  } catch {
    return { status: "error", message: "You are not allowed to change invoices." };
  }

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const status = String(formData.get("status") ?? "") as InvoiceStatus;
  if (!STATUSES.includes(status)) return { status: "error", message: "Unknown status." };

  const mine = await listInvoices(access.email);
  const invoice = mine.find((i) => i.id === invoiceId);
  if (!invoice) return { status: "error", message: "That invoice is not yours." };

  const ok = await setStatus(invoiceId, status);
  if (!ok) return { status: "error", message: "That invoice could not be updated." };

  revalidatePath("/invoices");
  return { status: "ok", message: `${invoice.invoiceNo} marked ${status.toLowerCase()}.` };
}

export async function discardDraft(
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  let access;
  try {
    access = await requireInvoices();
  } catch {
    return { status: "error", message: "You are not allowed to change invoices." };
  }

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const mine = await listInvoices(access.email);
  const invoice = mine.find((i) => i.id === invoiceId);
  if (!invoice) return { status: "error", message: "That invoice is not yours." };
  if (invoice.status !== "Draft") {
    return { status: "error", message: "Only a draft can be discarded." };
  }

  const ok = await deleteDraft(invoiceId);
  if (!ok) return { status: "error", message: "That draft could not be discarded." };

  revalidatePath("/invoices");
  return { status: "ok", message: `${invoice.invoiceNo} discarded.` };
}

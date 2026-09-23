"use client";

import {
  dueDate,
  effectiveStatus,
  gbp,
  type Customer,
  type Invoice,
  type InvoiceLine,
} from "@/lib/invoices-calc";

/**
 * The invoice as the customer receives it.
 *
 * Transcribed from `invoices.html`, which builds this markup and then calls
 * `window.print()`. Printed rather than drawn with jsPDF on purpose: this is a
 * page of typography — four blocks, a table and a totals stack — and the
 * browser sets that better than coordinates would, keeps the text selectable,
 * and reflows it if somebody prints to a different paper size.
 *
 * Everything on it except the customer comes from the invoice row, not from My
 * Profile. The seller's details were copied onto the invoice when it was
 * raised, so this keeps saying what was sent even after somebody changes their
 * address, their logo or their bank.
 */

const ukLong = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

export function InvoiceDocument({
  invoice,
  customer,
  lines,
}: {
  invoice: Invoice;
  customer: Customer | null;
  lines: InvoiceLine[];
}) {
  const due = dueDate(invoice);
  const status = effectiveStatus(invoice);
  const vatRegistered = Boolean(invoice.sellerVat);

  const billTo = [
    customer?.companyName,
    customer?.contactName,
    customer?.address1,
    customer?.address2,
    customer?.town,
    customer?.postcode,
  ].filter(Boolean) as string[];

  return (
    <section className="inv-doc" data-testid="invoice-document" aria-label="The printed invoice">
      <header className="ivd-head">
        <div className="ivd-brand">
          {invoice.sellerLogo ? (
            // Decorative: the business name is right beside it in text.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ivd-logo" src={invoice.sellerLogo} alt="" data-testid="doc-logo" />
          ) : null}
          <div className="ivd-wordmark">
            <span className="ivd-name" data-testid="doc-seller-name">
              {invoice.sellerName ?? ""}
            </span>
            {invoice.sellerTagline ? (
              <span className="ivd-tag">{invoice.sellerTagline}</span>
            ) : null}
          </div>
        </div>

        <div className="ivd-title">
          {/* The title says VAT INVOICE only when a VAT number is actually on
              the document. A customer reclaiming VAT needs the number, and a
              heading promising one that is not printed below is worse than the
              plain heading. */}
          <h2 data-testid="doc-title">{vatRegistered ? "VAT INVOICE" : "INVOICE"}</h2>
          <div className="ivd-no">
            <span data-testid="doc-no">{invoice.invoiceNo}</span>
            <span className={`ivd-badge is-${status.toLowerCase()}`} data-testid="doc-badge">
              {status}
            </span>
          </div>
        </div>
      </header>

      <div className="ivd-rule" />

      <section className="ivd-meta">
        <div className="ivd-block">
          <div className="ivd-eyebrow">From</div>
          <div className="ivd-strong">{invoice.sellerName ?? ""}</div>
          {invoice.sellerAddress
            ? invoice.sellerAddress.split(/\n|,\s*/).map((part, i) => <div key={i}>{part}</div>)
            : null}
          {invoice.sellerCompanyNo ? <div>Company no. {invoice.sellerCompanyNo}</div> : null}
          {invoice.sellerVat ? <div>VAT no. {invoice.sellerVat}</div> : null}
        </div>

        <div className="ivd-block">
          <div className="ivd-eyebrow">Bill To</div>
          {billTo.length === 0 ? (
            <div className="ivd-quiet">No customer details.</div>
          ) : (
            billTo.map((part, i) => (
              <div key={i} className={i === 0 ? "ivd-strong" : undefined}>
                {part}
              </div>
            ))
          )}
        </div>

        <div className="ivd-block">
          <div className="ivd-eyebrow">Details</div>
          <div className="ivd-row">
            <span>Invoice no.</span>
            <span>{invoice.invoiceNo}</span>
          </div>
          <div className="ivd-row">
            <span>Invoice date</span>
            <span>{ukLong(invoice.invoiceDate)}</span>
          </div>
          {due ? (
            <div className="ivd-row is-due">
              <span>Due by</span>
              <span data-testid="doc-due">
                {due.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {invoice.project ? (
        <div className="ivd-for">
          <b>Invoice for:</b> {invoice.project}
        </div>
      ) : null}

      <div className="ivd-scroll">
        <table className="ivd-items">
        <caption className="sr-only">Lines on invoice {invoice.invoiceNo}</caption>
        <thead>
          <tr>
            <th scope="col">Item #</th>
            <th scope="col">Description</th>
            <th scope="col" className="ivd-c">Qty</th>
            <th scope="col" className="ivd-r">Unit price</th>
            <th scope="col" className="ivd-r">VAT</th>
            <th scope="col" className="ivd-r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td />
              <td className="ivd-quiet">No lines yet.</td>
              <td />
              <td />
              <td />
              <td />
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.id}>
                <td>{l.itemNo ?? ""}</td>
                <td>{l.description}</td>
                <td className="ivd-c">{l.qty}</td>
                <td className="ivd-r">{gbp(l.unitPrice)}</td>
                <td className="ivd-r">{gbp(l.tax)}</td>
                <td className="ivd-r ivd-amt">{gbp(l.lineTotal)}</td>
              </tr>
            ))
          )}
        </tbody>
        </table>
      </div>

      <div className="ivd-foot">
        <div className="ivd-pay">
          <div className="ivd-eyebrow">Payment Details</div>
          <div className="ivd-paygrid">
            {invoice.sellerBankName ? (
              <>
                <span className="ivd-k">Payee</span>
                <span className="ivd-v">{invoice.sellerBankName}</span>
              </>
            ) : null}
            {invoice.sellerSortCode ? (
              <>
                <span className="ivd-k">Sort code</span>
                <span className="ivd-v ivd-num" data-testid="doc-sort">
                  {formatSort(invoice.sellerSortCode)}
                </span>
              </>
            ) : null}
            {invoice.sellerAccountNo ? (
              <>
                <span className="ivd-k">Account no.</span>
                <span className="ivd-v ivd-num" data-testid="doc-account">
                  {invoice.sellerAccountNo}
                </span>
              </>
            ) : null}
            <span className="ivd-k">Reference</span>
            <span className="ivd-v">{invoice.invoiceNo}</span>
          </div>

          {invoice.paymentTermsDays != null ? (
            <p className="ivd-terms" data-testid="doc-terms">
              <b>Payment terms:</b> Total due within {invoice.paymentTermsDays} days. Please quote
              the invoice number above with your payment.
              {invoice.sellerBankName ? ` Cheques payable to ${invoice.sellerBankName}.` : ""}
            </p>
          ) : null}
        </div>

        <div className="ivd-totals">
          <div className="ivd-tline">
            <span className="ivd-k">Subtotal (net)</span>
            <span className="ivd-v ivd-num">{gbp(invoice.unitTotal)}</span>
          </div>
          <div className="ivd-tline">
            <span className="ivd-k">VAT @ {invoice.taxRate.toFixed(2)}%</span>
            <span className="ivd-v ivd-num">{gbp(invoice.taxTotal)}</span>
          </div>
          <div className="ivd-grand">
            <span className="ivd-k">Total Due</span>
            <span className="ivd-v ivd-num" data-testid="doc-total">
              {gbp(invoice.invoiceTotal)}
            </span>
          </div>
        </div>
      </div>

      <div className="ivd-baseline">
        <span>Thank you for your business.</span>
        {invoice.sellerVat ? (
          <span className="ivd-vat">VAT Registration No. {invoice.sellerVat}</span>
        ) : (
          <span>{invoice.sellerName ?? ""}</span>
        )}
      </div>
    </section>
  );
}

/** 204567 -> 20-45-67. Stored as six digits; grouped only where it is read. */
function formatSort(code: string): string {
  const d = code.replace(/\D/g, "");
  return d.length === 6 ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}` : code;
}

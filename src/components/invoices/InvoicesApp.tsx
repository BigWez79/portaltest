"use client";

import { useActionState, useMemo, useState } from "react";
import { InvoiceDocument } from "./InvoiceDocument";
import {
  addInvoiceLine,
  discardDraft,
  editCustomer,
  editInvoice,
  markInvoice,
  raiseInvoice,
  removeCustomer,
  removeInvoice,
  removeInvoiceLine,
  saveCustomer,
  type InvoiceState,
} from "@/app/actions/invoices";
import {
  DEFAULT_TAX_RATE,
  INVOICE_FILTERS,
  effectiveStatus,
  gbp,
  lineAmounts,
  matchesFilter,
  nextInvoiceNo,
  type Customer,
  type Invoice,
  type InvoiceFilter,
  type InvoiceLine,
} from "@/lib/invoices-calc";

const idle: InvoiceState = { status: "idle" };

const ukDate = (d: string) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "";

export function InvoicesApp({
  invoices,
  customers,
  linesByInvoice,
  suggestedNo,
  openId,
}: {
  invoices: Invoice[];
  customers: Customer[];
  linesByInvoice: Record<string, InvoiceLine[]>;
  /** The next number in this seller's own sequence, worked out on the server. */
  suggestedNo: string;
  openId: string | null;
}) {
  const [raise, raiseAction, raising] = useActionState(raiseInvoice, idle);
  const [line, lineAction, addingLine] = useActionState(addInvoiceLine, idle);
  const [strike, strikeAction] = useActionState(removeInvoiceLine, idle);
  const [mark, markAction] = useActionState(markInvoice, idle);
  const [discard, discardAction] = useActionState(discardDraft, idle);
  const [cust, custAction, savingCustomer] = useActionState(saveCustomer, idle);
  const [edit, editAction, editing] = useActionState(editInvoice, idle);
  const [wipe, wipeAction] = useActionState(removeInvoice, idle);
  const [custEdit, custEditAction] = useActionState(editCustomer, idle);
  const [custWipe, custWipeAction] = useActionState(removeCustomer, idle);

  const [tab, setTab] = useState<"invoices" | "customers">("invoices");
  const [filter, setFilter] = useState<InvoiceFilter>("All");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(openId);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");

  const customerName = useMemo(() => {
    const m = new Map(customers.map((c) => [c.id, c.companyName]));
    return (id: string) => m.get(id) ?? "—";
  }, [customers]);


  // Worked out once per render rather than per row: `matchesFilter` builds a
  // date for every invoice it is asked about, and the list re-renders on every
  // keystroke in the line form above it.
  const shown = useMemo(() => invoices.filter((i) => matchesFilter(i, filter)), [invoices, filter]);
  const being = customers.find((c) => c.id === editingCustomer) ?? null;
  const custState = being ? custEdit : cust;

  const open = invoices.find((i) => i.id === selected) ?? null;
  const openLines = open ? (linesByInvoice[open.id] ?? []) : [];

  // What the line being typed will come to, at the rate the invoice carries.
  // The server works it out again from the invoice — this only saves somebody
  // reaching for a calculator.
  const preview = useMemo(() => {
    if (!open) return null;
    const q = Number(qty);
    const u = Number(unit);
    if (!Number.isFinite(q) || !Number.isFinite(u) || q <= 0) return null;
    return lineAmounts(q, u, open.taxRate);
  }, [qty, unit, open]);

  const totals = useMemo(
    () => ({
      draft: invoices.filter((i) => i.status === "Draft").length,
      owed: invoices.filter((i) => i.status === "Sent").reduce((s, i) => s + i.invoiceTotal, 0),
      paid: invoices.filter((i) => i.status === "Paid").reduce((s, i) => s + i.invoiceTotal, 0),
    }),
    [invoices],
  );

  return (
    <div className="inv-app" data-testid="invoices-app">
      <div className="inv-kpis">
        <div className="kpi" data-testid="kpi-draft">
          <div className="k">Drafts</div>
          <div className="v">{totals.draft}</div>
        </div>
        <div className="kpi accent" data-testid="kpi-owed">
          <div className="k">Sent, not yet paid</div>
          <div className="v">{gbp(totals.owed)}</div>
        </div>
        <div className="kpi good" data-testid="kpi-paid">
          <div className="k">Paid</div>
          <div className="v">{gbp(totals.paid)}</div>
        </div>
      </div>

      <div className="seg" role="group" aria-label="What to work on">
        <button
          type="button"
          aria-pressed={tab === "invoices"}
          onClick={() => setTab("invoices")}
          data-testid="tab-invoices"
        >
          Invoices
        </button>
        <button
          type="button"
          aria-pressed={tab === "customers"}
          onClick={() => setTab("customers")}
          data-testid="tab-customers"
        >
          Customers
        </button>
      </div>

      {tab === "invoices" ? (
        <>
          <section className="inv-card">
            <h2 className="inv-h">
              Raise an invoice <span className="tag">numbers are yours alone</span>
            </h2>

            <form action={raiseAction} className="inv-form" data-testid="raise-form">
              <div className="inv-grid">
                <label className="field app-field">
                  <span className="field-label">Number</span>
                  <input
                    type="text"
                    name="invoiceNo"
                    required
                    defaultValue={suggestedNo}
                    data-testid="invoice-no"
                  />
                  <span className="inv-hint" data-testid="invoice-no-hint">
                    Next in your sequence: {suggestedNo}. The prefix comes from My Profile.
                  </span>
                </label>
                <label className="field app-field">
                  <span className="field-label">Customer</span>
                  <select name="customerId" required data-testid="invoice-customer">
                    <option value="">Choose…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.companyName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field app-field">
                  <span className="field-label">Date</span>
                  <input
                    type="date"
                    name="invoiceDate"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    data-testid="invoice-date"
                  />
                </label>
                <label className="field app-field">
                  <span className="field-label">VAT rate (%)</span>
                  <input
                    type="number"
                    name="taxRate"
                    step="0.01"
                    min="0"
                    max="100"
                    defaultValue={DEFAULT_TAX_RATE}
                    data-testid="invoice-rate"
                  />
                </label>
                <label className="field app-field inv-wide">
                  <span className="field-label">Project</span>
                  <input type="text" name="project" data-testid="invoice-project" />
                </label>
              </div>

              {raise.status === "error" ? (
                <div className="msg" role="alert" data-testid="raise-error">
                  {raise.message}
                </div>
              ) : null}
              {raise.status === "ok" ? (
                <div className="msg ok" role="status" data-testid="raise-ok">
                  {raise.message}
                </div>
              ) : null}

              <div>
                <button type="submit" className="primary" disabled={raising} data-testid="raise-submit">
                  {raising ? "Creating…" : "Create invoice"}
                </button>
              </div>
            </form>
          </section>

          <div className="inv-filters" data-testid="invoice-filters">
            <div className="seg" role="group" aria-label="Which invoices to show">
              {INVOICE_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  data-testid={`filter-${f.replace(/\W+/g, "-").toLowerCase()}`}
                >
                  {f}
                </button>
              ))}
            </div>
            <span className="inv-count" data-testid="filter-count">
              {shown.length} of {invoices.length}
            </span>
          </div>

          {invoices.length === 0 ? (
            <p className="inv-empty" data-testid="invoices-empty">
              No invoices yet. Raise the first one above.
            </p>
          ) : null}

          {shown.length === 0 && invoices.length > 0 ? (
            <p className="inv-empty" data-testid="filter-empty">
              Nothing under {filter}.
            </p>
          ) : null}

          {shown.map((inv) => {
            const lines = linesByInvoice[inv.id] ?? [];
            const isOpen = selected === inv.id;
            return (
              <section
                className="inv-card"
                key={inv.id}
                data-testid={`invoice-${inv.invoiceNo}`}
                data-id={inv.id}
              >
                <div className="inv-head">
                  <button
                    type="button"
                    className="inv-toggle"
                    onClick={() => setSelected(isOpen ? null : inv.id)}
                    aria-expanded={isOpen}
                    data-testid={`open-${inv.invoiceNo}`}
                  >
                    <span className="inv-no">{inv.invoiceNo}</span>
                    <span className="inv-cust">{customerName(inv.customerId)}</span>
                    <span className="inv-date">{ukDate(inv.invoiceDate)}</span>
                  </button>
                  <span
                    className={`inv-status is-${effectiveStatus(inv).toLowerCase()}`}
                    data-testid={`status-${inv.invoiceNo}`}
                    // What is stored, for anything that needs to tell the two
                    // apart. Overdue is never written, and a test proving that
                    // has to be able to see the difference.
                    data-stored={inv.status}
                  >
                    {effectiveStatus(inv)}
                  </span>
                  <span className="inv-total" data-testid={`total-${inv.invoiceNo}`}>
                    {gbp(inv.invoiceTotal)}
                  </span>
                </div>

                {isOpen ? (
                  <>
                    <div className="inv-scroll">
                      <table className="inv-table">
                        <caption className="sr-only">Lines on invoice {inv.invoiceNo}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Item</th>
                            <th scope="col">Description</th>
                            <th scope="col" className="inv-num">Qty</th>
                            <th scope="col" className="inv-num">Unit</th>
                            <th scope="col" className="inv-num">VAT</th>
                            <th scope="col" className="inv-num">Total</th>
                            <th scope="col">
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="inv-noline">
                                Nothing on this invoice yet.
                              </td>
                            </tr>
                          ) : null}
                          {lines.map((l) => (
                            <tr key={l.id}>
                              <td>{l.itemNo ?? "—"}</td>
                              <td>{l.description}</td>
                              <td className="inv-num">{l.qty}</td>
                              <td className="inv-num">{gbp(l.unitPrice)}</td>
                              <td className="inv-num">{gbp(l.tax)}</td>
                              <td className="inv-num">{gbp(l.lineTotal)}</td>
                              <td className="inv-line-actions">
                                {inv.status === "Paid" ? null : (
                                  <form action={strikeAction} className="inv-inline">
                                    <input type="hidden" name="invoiceId" value={inv.id} />
                                    <input type="hidden" name="lineId" value={l.id} />
                                    <button type="submit" className="quiet danger" data-testid={`strike-${l.id}`}>
                                      Remove<span className="sr-only"> {l.description}</span>
                                    </button>
                                  </form>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={4} />
                            <th scope="row" className="inv-num">Net</th>
                            <td className="inv-num" data-testid={`net-${inv.invoiceNo}`}>
                              {gbp(inv.unitTotal)}
                            </td>
                            <td />
                          </tr>
                          <tr>
                            <td colSpan={4} />
                            <th scope="row" className="inv-num">VAT at {inv.taxRate}%</th>
                            <td className="inv-num" data-testid={`vat-${inv.invoiceNo}`}>
                              {gbp(inv.taxTotal)}
                            </td>
                            <td />
                          </tr>
                          <tr className="inv-grand">
                            <td colSpan={4} />
                            <th scope="row" className="inv-num">Total</th>
                            <td className="inv-num" data-testid={`grand-${inv.invoiceNo}`}>
                              {gbp(inv.invoiceTotal)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <div className="inv-docwrap">
                      <div className="inv-docbar">
                        <h3 className="inv-doch">The document</h3>
                        <button
                          type="button"
                          className="inv-print"
                          onClick={() => window.print()}
                          data-testid={`print-${inv.invoiceNo}`}
                        >
                          Print / Save PDF
                        </button>
                      </div>
                      <InvoiceDocument
                        invoice={inv}
                        customer={customers.find((c) => c.id === inv.customerId) ?? null}
                        lines={lines}
                      />
                    </div>

                    {inv.status === "Paid" ? (
                      <p className="inv-quiet" data-testid={`locked-${inv.invoiceNo}`}>
                        Paid on {ukDate(inv.paidDate ?? "")}. A paid invoice can no longer be changed.
                      </p>
                    ) : (
                      <form action={lineAction} className="inv-lineform" data-testid="line-form">
                        <input type="hidden" name="invoiceId" value={inv.id} />
                        <div className="inv-linegrid">
                          <label className="field app-field">
                            <span className="field-label">Item</span>
                            <input type="text" name="itemNo" data-testid="line-item" />
                          </label>
                          <label className="field app-field inv-wide">
                            <span className="field-label">Description</span>
                            <input type="text" name="description" required data-testid="line-desc" />
                          </label>
                          <label className="field app-field">
                            <span className="field-label">Qty</span>
                            <input
                              type="number"
                              name="qty"
                              step="0.001"
                              min="0.001"
                              required
                              value={qty}
                              onChange={(e) => setQty(e.target.value)}
                              data-testid="line-qty"
                            />
                          </label>
                          <label className="field app-field">
                            <span className="field-label">Unit price</span>
                            <input
                              type="number"
                              name="unitPrice"
                              step="0.01"
                              min="0"
                              required
                              value={unit}
                              onChange={(e) => setUnit(e.target.value)}
                              data-testid="line-unit"
                            />
                          </label>
                        </div>

                        {preview ? (
                          <p className="inv-preview" data-testid="line-preview">
                            {gbp(preview.net)} net, {gbp(preview.tax)} VAT —{" "}
                            <strong>{gbp(preview.total)}</strong>
                          </p>
                        ) : null}

                        {line.status === "error" ? (
                          <div className="msg" role="alert" data-testid="line-error">
                            {line.message}
                          </div>
                        ) : null}

                        <button type="submit" className="btn-add" disabled={addingLine} data-testid="line-add">
                          {addingLine ? "Adding…" : "+ Add line"}
                        </button>
                      </form>
                    )}

                    <div className="inv-actions">
                      {inv.status === "Draft" ? (
                        <form action={markAction} className="inv-inline">
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="status" value="Sent" />
                          <button type="submit" className="primary" data-testid={`send-${inv.invoiceNo}`}>
                            Mark as sent
                          </button>
                        </form>
                      ) : null}
                      {inv.status === "Sent" ? (
                        <form action={markAction} className="inv-inline">
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="status" value="Paid" />
                          <button type="submit" className="btn-good" data-testid={`pay-${inv.invoiceNo}`}>
                            Mark as paid
                          </button>
                        </form>
                      ) : null}
                      {inv.status === "Draft" ? (
                        <form action={discardAction} className="inv-inline">
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <button type="submit" className="quiet danger" data-testid={`discard-${inv.invoiceNo}`}>
                            Discard draft
                          </button>
                        </form>
                      ) : null}

                      {inv.status !== "Paid" ? (
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setEditingId(editingId === inv.id ? null : inv.id)}
                          aria-expanded={editingId === inv.id}
                          data-testid={`edit-${inv.invoiceNo}`}
                        >
                          {editingId === inv.id ? "Cancel edit" : "Edit"}
                        </button>
                      ) : null}

                      {inv.status !== "Paid" && inv.status !== "Draft" ? (
                        <form action={wipeAction} className="inv-inline">
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <button
                            type="submit"
                            className="quiet danger"
                            data-testid={`delete-${inv.invoiceNo}`}
                          >
                            Delete
                          </button>
                        </form>
                      ) : null}
                    </div>

                    {editingId === inv.id ? (
                      <form
                        action={editAction}
                        className="inv-form inv-editform"
                        data-testid={`editform-${inv.invoiceNo}`}
                      >
                        <input type="hidden" name="invoiceId" value={inv.id} />
                        <h4 className="inv-edith">Correct this invoice</h4>
                        <div className="inv-grid">
                          <label className="field app-field">
                            <span className="field-label">Number</span>
                            <input
                              type="text"
                              name="invoiceNo"
                              required
                              defaultValue={inv.invoiceNo}
                              data-testid="edit-no"
                            />
                          </label>
                          <label className="field app-field">
                            <span className="field-label">Customer</span>
                            <select
                              name="customerId"
                              required
                              defaultValue={inv.customerId}
                              data-testid="edit-customer"
                            >
                              {customers.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.companyName}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="field app-field">
                            <span className="field-label">Date</span>
                            <input
                              type="date"
                              name="invoiceDate"
                              required
                              defaultValue={inv.invoiceDate}
                              data-testid="edit-date"
                            />
                          </label>
                          <label className="field app-field">
                            <span className="field-label">VAT rate (%)</span>
                            <input
                              type="number"
                              name="taxRate"
                              step="0.01"
                              min="0"
                              defaultValue={inv.taxRate}
                              data-testid="edit-rate"
                            />
                          </label>
                          <label className="field app-field inv-wide">
                            <span className="field-label">Project</span>
                            <input
                              type="text"
                              name="project"
                              defaultValue={inv.project ?? ""}
                              data-testid="edit-project"
                            />
                          </label>
                        </div>
                        <p className="inv-hint">
                          Changing the VAT rate re-prices every line on this invoice — a rate on the
                          header that disagrees with the tax on the lines is a document that does not
                          add up.
                        </p>
                        <button
                          type="submit"
                          className="primary"
                          disabled={editing}
                          data-testid="edit-submit"
                        >
                          {editing ? "Saving…" : "Save changes"}
                        </button>
                      </form>
                    ) : null}

                    {edit.status === "error" ? (
                      <div className="msg" role="alert" data-testid="edit-error">
                        {edit.message}
                      </div>
                    ) : null}
                    {wipe.status === "error" ? (
                      <div className="msg" role="alert" data-testid="delete-error">
                        {wipe.message}
                      </div>
                    ) : null}

                    {mark.status === "ok" ? (
                      <div className="msg ok" role="status" data-testid="mark-ok">
                        {mark.message}
                      </div>
                    ) : null}
                    {mark.status === "error" ? (
                      <div className="msg" role="alert" data-testid="mark-error">
                        {mark.message}
                      </div>
                    ) : null}
                    {strike.status === "error" ? (
                      <div className="msg" role="alert" data-testid="strike-error">
                        {strike.message}
                      </div>
                    ) : null}
                    {discard.status === "error" ? (
                      <div className="msg" role="alert" data-testid="discard-error">
                        {discard.message}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </section>
            );
          })}
        </>
      ) : (
        <section className="inv-card" data-testid="customers-panel">
          <h2 className="inv-h">
            Customers <span className="tag">shared with everybody</span>
          </h2>

          <div className="inv-scroll">
            <table className="inv-table">
              <caption className="sr-only">Customers everybody can invoice</caption>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Town</th>
                  <th scope="col">Email</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="inv-noline">
                      No customers yet.
                    </td>
                  </tr>
                ) : null}
                {customers.map((c) => (
                  <tr key={c.id} data-testid={`customer-${c.id}`}>
                    <td>{c.companyName}</td>
                    <td>{c.contactName ?? "—"}</td>
                    <td>{c.town ?? "—"}</td>
                    <td>{c.email ?? "—"}</td>
                    <td className="inv-rowactions">
                      <button
                        type="button"
                        className="quiet"
                        onClick={() =>
                          setEditingCustomer(editingCustomer === c.id ? null : c.id)
                        }
                        data-testid={`cust-edit-${c.id}`}
                      >
                        Edit<span className="sr-only"> {c.companyName}</span>
                      </button>
                      <form action={custWipeAction} className="inv-inline">
                        <input type="hidden" name="customerId" value={c.id} />
                        <button
                          type="submit"
                          className="quiet danger"
                          data-testid={`cust-remove-${c.id}`}
                        >
                          Remove<span className="sr-only"> {c.companyName}</span>
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {custWipe.status === "error" ? (
            <div className="msg" role="alert" data-testid="cust-remove-error">
              {custWipe.message}
            </div>
          ) : null}

          <form
            action={being ? custEditAction : custAction}
            className="inv-form"
            // Remounts when the customer being edited changes, so every box
            // takes its new defaultValue. Without it, switching from one
            // customer to another keeps the first one's address on screen while
            // the hidden id points at the second.
            key={being?.id ?? "new"}
            data-testid="customer-form"
          >
            {being ? <input type="hidden" name="customerId" value={being.id} /> : null}
            <h3 className="inv-edith">
              {being ? `Edit ${being.companyName}` : "Add a customer"}
            </h3>
            <div className="inv-grid">
              <label className="field app-field inv-wide">
                <span className="field-label">Company name</span>
                <input type="text" name="companyName" required defaultValue={being?.companyName ?? ""} data-testid="cust-name" />
              </label>
              <label className="field app-field">
                <span className="field-label">Contact</span>
                <input type="text" name="contactName" defaultValue={being?.contactName ?? ""} data-testid="cust-contact" />
              </label>
              <label className="field app-field">
                <span className="field-label">Email</span>
                <input type="email" name="email" defaultValue={being?.email ?? ""} data-testid="cust-email" />
              </label>
              <label className="field app-field">
                <span className="field-label">Address line 1</span>
                <input type="text" name="address1" defaultValue={being?.address1 ?? ""} data-testid="cust-a1" />
              </label>
              <label className="field app-field">
                <span className="field-label">Address line 2</span>
                <input type="text" name="address2" defaultValue={being?.address2 ?? ""} />
              </label>
              <label className="field app-field">
                <span className="field-label">Town</span>
                <input type="text" name="town" defaultValue={being?.town ?? ""} data-testid="cust-town" />
              </label>
              <label className="field app-field">
                <span className="field-label">Postcode</span>
                <input type="text" name="postcode" defaultValue={being?.postcode ?? ""} data-testid="cust-postcode" />
              </label>
              <label className="field app-field">
                <span className="field-label">Phone</span>
                <input type="text" name="phone" defaultValue={being?.phone ?? ""} />
              </label>
            </div>

            {/* One form, two actions, so the message has to come from whichever
                one it was posted to — reading only `cust` left an edit looking
                like it had silently done nothing. */}
            {custState.status === "error" ? (
              <div className="msg" role="alert" data-testid="cust-error">
                {custState.message}
              </div>
            ) : null}
            {custState.status === "ok" ? (
              <div className="msg ok" role="status" data-testid="cust-ok">
                {custState.message}
              </div>
            ) : null}

            <div>
              <button type="submit" className="primary" disabled={savingCustomer} data-testid="cust-save">
                {savingCustomer ? "Saving…" : being ? "Save customer" : "Add customer"}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

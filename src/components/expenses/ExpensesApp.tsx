"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { downloadClaimPdf, type ClaimPerson } from "./claim-pdf";
import type { PdfSeller } from "@/lib/pdf";
import {
  lockClaimMonth,
  removeExpense,
  submitExpense,
  updateRates,
  type ExpenseState,
} from "@/app/actions/expenses";
import {
  EXPENSE_TYPES,
  mileageAmount,
  priorMilesInTaxYear,
  type Expense,
  type ExpenseType,
  type MileageRates,
} from "@/lib/expenses-calc";

const idle: ExpenseState = { status: "idle" };

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export function ExpensesApp({
  rows,
  rates,
  locked,
  isAdmin,
  person,
  seller,
}: {
  rows: Expense[];
  rates: MileageRates;
  locked: string[];
  isAdmin: boolean;
  person: ClaimPerson;
  seller: PdfSeller;
}) {
  const [form, formAction, saving] = useActionState(submitExpense, idle);
  const [removeState, removeAction] = useActionState(removeExpense, idle);
  const [lockState, lockAction] = useActionState(lockClaimMonth, idle);
  const [rateState, rateAction, savingRates] = useActionState(updateRates, idle);

  const [claimProblem, setClaimProblem] = useState<string | null>(null);
  const [type, setType] = useState<ExpenseType>("Mileage");
  const [miles, setMiles] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<Expense | null>(null);

  const months = useMemo(() => {
    const seen = new Map<string, Expense[]>();
    for (const r of rows) {
      const list = seen.get(r.claimMonth) ?? [];
      list.push(r);
      seen.set(r.claimMonth, list);
    }
    return [...seen.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  // Shown before saving so nobody has to guess what a journey is worth. The
  // server prices it again from the caller's own rows — this is a preview, not
  // the number that gets stored.
  const preview = useMemo(() => {
    const m = Number(miles);
    if (type !== "Mileage" || !Number.isFinite(m) || m <= 0) return null;
    const prior = priorMilesInTaxYear(rows, date, editing?.id);
    return { amount: mileageAmount(m, prior, rates), prior };
  }, [type, miles, date, rows, rates, editing]);

  // A save that succeeded leaves the form sitting in "Edit expense" with the
  // old row still loaded, which reads as though nothing happened. Drop back to
  // a blank Add form once the server says it took.
  useEffect(() => {
    if (form.status === "ok" && editing) clearEdit();
    // clearEdit is stable for this component's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.status]);

  const isLocked = (month: string) => locked.includes(month);

  function startEdit(row: Expense) {
    setEditing(row);
    setType(row.expenseType);
    setMiles(row.miles == null ? "" : String(row.miles));
    setDate(row.expenseDate);
  }

  function clearEdit() {
    setEditing(null);
    setType("Mileage");
    setMiles("");
    setDate(new Date().toISOString().slice(0, 10));
  }

  return (
    <div className="exp-app" data-testid="expenses-app">
      <section className="exp-card">
        <h2 className="exp-h">{editing ? "Edit expense" : "Add an expense"}</h2>

        <form action={formAction} className="exp-form" data-testid="expense-form">
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

          {/* Keyed on the row being edited so React rebuilds the uncontrolled
              fields when you switch rows. Without it, defaultValue is only read
              on first mount and Edit appears to do nothing to them. */}
          <div className="exp-grid" key={editing?.id ?? "new"}>
            <label className="field">
              <span className="field-label">Date</span>
              <input
                type="date"
                name="expenseDate"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="expense-date"
              />
            </label>

            <label className="field">
              <span className="field-label">Type</span>
              <select
                name="expenseType"
                value={type}
                onChange={(e) => setType(e.target.value as ExpenseType)}
                data-testid="expense-type"
              >
                {EXPENSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "Mileage" ? "Mileage (own car)" : t}
                  </option>
                ))}
              </select>
            </label>

            {type === "Mileage" ? (
              <>
                <label className="field">
                  <span className="field-label">Miles</span>
                  <input
                    type="number"
                    name="miles"
                    step="0.1"
                    min="0.1"
                    required
                    value={miles}
                    onChange={(e) => setMiles(e.target.value)}
                    data-testid="expense-miles"
                  />
                </label>
                <label className="field">
                  <span className="field-label">From</span>
                  <input
                    type="text"
                    name="fromLocation"
                    defaultValue={editing?.fromLocation ?? ""}
                    data-testid="expense-from"
                  />
                </label>
                <label className="field">
                  <span className="field-label">To</span>
                  <input
                    type="text"
                    name="toLocation"
                    defaultValue={editing?.toLocation ?? ""}
                    data-testid="expense-to"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">Amount</span>
                  <input
                    type="number"
                    name="amount"
                    step="0.01"
                    min="0"
                    required
                    defaultValue={editing && editing.expenseType !== "Mileage" ? editing.amount : ""}
                    data-testid="expense-amount"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Receipt held</span>
                  <select
                    name="receiptHeld"
                    defaultValue={editing?.receiptHeld === false ? "no" : "yes"}
                    data-testid="expense-receipt"
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </>
            )}

            <label className="field exp-wide">
              <span className="field-label">Reason</span>
              <input
                type="text"
                name="reason"
                defaultValue={editing?.reason ?? ""}
                data-testid="expense-reason"
              />
            </label>

            <label className="field exp-wide">
              <span className="field-label">Notes</span>
              <input
                type="text"
                name="notes"
                defaultValue={editing?.notes ?? ""}
                data-testid="expense-notes"
              />
            </label>
          </div>

          {preview ? (
            <p className="exp-preview" data-testid="mileage-preview">
              {miles} miles at this year&rsquo;s rates comes to <strong>{gbp(preview.amount)}</strong>
              {preview.prior > 0 ? (
                <span className="exp-quiet">
                  {" "}
                  — {preview.prior.toLocaleString("en-GB")} miles already claimed since 6 April
                </span>
              ) : null}
            </p>
          ) : null}

          {form.status === "error" ? (
            <div className="msg" role="alert" data-testid="expense-error">
              {form.message}
            </div>
          ) : null}
          {form.status === "ok" ? (
            <div className="msg ok" role="status" data-testid="expense-ok">
              {form.message}
            </div>
          ) : null}

          <div className="exp-actions">
            <button type="submit" className="primary" disabled={saving} data-testid="expense-submit">
              {saving ? "Saving…" : editing ? "Update expense" : "Add expense"}
            </button>
            {editing ? (
              <button type="button" className="quiet" onClick={clearEdit} data-testid="expense-cancel">
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {removeState.status === "error" ? (
        <div className="msg" role="alert" data-testid="remove-error">
          {removeState.message}
        </div>
      ) : null}
      {lockState.status === "ok" ? (
        <div className="msg ok" role="status" data-testid="lock-ok">
          {lockState.message}
        </div>
      ) : null}
      {lockState.status === "error" ? (
        <div className="msg" role="alert" data-testid="lock-error">
          {lockState.message}
        </div>
      ) : null}

      {months.length === 0 ? (
        <p className="exp-empty" data-testid="expenses-empty">
          Nothing claimed yet. Add your first expense above.
        </p>
      ) : null}

      {months.map(([month, list]) => {
        const total = list.reduce((sum, r) => sum + r.amount, 0);
        const shut = isLocked(month);
        return (
          <section className="exp-card" key={month} data-testid={`month-${month}`}>
            <div className="exp-month-head">
              <h2 className="exp-h">
                {monthName(month)}
                {shut ? (
                  <span className="exp-lock" data-testid={`locked-${month}`}>
                    Submitted
                  </span>
                ) : null}
              </h2>
              <div className="exp-monthbar">
                <button
                  type="button"
                  className="exp-download"
                  onClick={() =>
                    downloadClaimPdf({ month, rows: list, person, seller }).catch(() =>
                      setClaimProblem(month),
                    )
                  }
                  data-testid={`claim-${month}`}
                >
                  Download claim (PDF)
                </button>
                <div className="exp-total" data-testid={`total-${month}`}>
                  {gbp(total)}
                </div>
              </div>
            </div>

            {claimProblem === month ? (
              <p className="exp-problem" role="status" data-testid={`claim-problem-${month}`}>
                That claim could not be produced. Reload the page and try again.
              </p>
            ) : null}

            <div className="exp-scroll">
              <table className="exp-table">
                <caption className="sr-only">
                  Expenses claimed in {monthName(month)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Type</th>
                    <th scope="col">Detail</th>
                    <th scope="col">Receipt</th>
                    <th scope="col" className="exp-num">
                      Amount
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} data-testid={`row-${r.id}`}>
                      <td>{new Date(`${r.expenseDate}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC" })}</td>
                      <td>{r.expenseType}</td>
                      <td>
                        {r.expenseType === "Mileage"
                          ? `${r.miles} miles${r.fromLocation ? `, ${r.fromLocation} to ${r.toLocation ?? ""}` : ""}`
                          : (r.reason ?? "")}
                      </td>
                      <td>{r.expenseType === "Mileage" ? "—" : r.receiptHeld ? "Yes" : "No"}</td>
                      <td className="exp-num">{gbp(r.amount)}</td>
                      <td className="exp-row-actions">
                        {shut ? null : (
                          <>
                            <button
                              type="button"
                              className="quiet"
                              onClick={() => startEdit(r)}
                              data-testid={`edit-${r.id}`}
                            >
                              Edit<span className="sr-only"> {r.expenseType} on {r.expenseDate}</span>
                            </button>
                            <form action={removeAction} className="exp-inline">
                              <input type="hidden" name="id" value={r.id} />
                              <button type="submit" className="quiet danger" data-testid={`remove-${r.id}`}>
                                Remove<span className="sr-only"> {r.expenseType} on {r.expenseDate}</span>
                              </button>
                            </form>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {shut ? null : (
              <form action={lockAction} className="exp-submit-claim">
                <input type="hidden" name="month" value={month} />
                <button type="submit" className="primary" data-testid={`submit-${month}`}>
                  Submit {monthName(month)} claim
                </button>
                <span className="exp-quiet">Once submitted, the month can no longer be changed.</span>
              </form>
            )}
          </section>
        );
      })}

      {isAdmin ? (
        <section className="exp-card" data-testid="rates-card">
          <h2 className="exp-h">Mileage rates</h2>
          <form action={rateAction} className="exp-rates">
            <label className="field">
              <span className="field-label">First rate (per mile)</span>
              <input type="number" name="rate1" step="0.001" min="0" defaultValue={rates.rate1} data-testid="rate1" />
            </label>
            <label className="field">
              <span className="field-label">Threshold (miles a year)</span>
              <input type="number" name="threshold" step="1" min="0" defaultValue={rates.threshold} data-testid="threshold" />
            </label>
            <label className="field">
              <span className="field-label">Rate beyond it</span>
              <input type="number" name="rate2" step="0.001" min="0" defaultValue={rates.rate2} data-testid="rate2" />
            </label>
            <button type="submit" className="primary" disabled={savingRates} data-testid="save-rates">
              {savingRates ? "Saving…" : "Save rates"}
            </button>
          </form>
          {rateState.status === "ok" ? (
            <div className="msg ok" role="status" data-testid="rates-ok">
              {rateState.message}
            </div>
          ) : null}
          {rateState.status === "error" ? (
            <div className="msg" role="alert" data-testid="rates-error">
              {rateState.message}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

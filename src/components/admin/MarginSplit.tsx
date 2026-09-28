"use client";

import { useActionState, useState } from "react";
import {
  type SplitState,
  submitContractor,
  submitDrawing,
  submitJob,
  submitShares,
} from "@/app/actions/margin-split";
import {
  type Contractor,
  type Drawing,
  type Job,
  type Summary,
  balance,
  contribution,
  equalShares,
  percent,
  pounds,
} from "@/lib/margin-split-calc";

const initial: SplitState = { status: "idle" };

/** A form wired to one action, with its outcome under it. */
function ActionForm({
  id,
  action,
  label,
  children,
}: {
  id: string;
  action: (previous: SplitState, formData: FormData) => Promise<SplitState>;
  label: string;
  children: React.ReactNode;
}) {
  const [state, run, pending] = useActionState(action, initial);
  return (
    <form action={run} className="invite-form" data-testid={`${id}-form`}>
      <div className="split-fields">{children}</div>
      {state.status === "error" ? (
        <div className="msg" role="alert" data-testid={`${id}-error`}>
          {state.message}
        </div>
      ) : null}
      {state.status === "ok" ? (
        <div className="msg ok" role="status" data-testid={`${id}-ok`}>
          {state.message}
        </div>
      ) : null}
      <button className="btn-primary" type="submit" disabled={pending} data-testid={`${id}-submit`}>
        {pending ? "Saving…" : label}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function SharesForm({ contractors }: { contractors: Contractor[] }) {
  const [shares, setShares] = useState(() => contractors.map((c) => percent(c.shareBp).slice(0, -1)));
  return (
    <ActionForm id="shares" action={submitShares} label="Save names and shares">
      {contractors.map((c, i) => (
        <div key={c.id} className="split-share">
          <Field label="Name">
            <input type="text" name={`name-${c.id}`} defaultValue={c.name} data-testid={`share-name-${i}`} />
          </Field>
          <Field label="Share %">
            <input
              type="text"
              inputMode="decimal"
              name={`share-${c.id}`}
              value={shares[i] ?? ""}
              onChange={(e) => setShares(shares.map((s, j) => (j === i ? e.target.value : s)))}
              data-testid={`share-${i}`}
            />
          </Field>
        </div>
      ))}
      <button
        type="button"
        className="btn-ghost split-equal"
        onClick={() => setShares(equalShares(contractors.length).map((bp) => percent(bp).slice(0, -1)))}
        data-testid="shares-equal"
      >
        Split equally
      </button>
    </ActionForm>
  );
}

export function MarginSplit({
  jobs,
  contractors,
  drawings,
  summary,
}: {
  jobs: Job[];
  contractors: Contractor[];
  drawings: Drawing[];
  summary: Summary;
}) {
  const names = new Map(contractors.map((c) => [c.id, c.name]));
  const allocatedSum = summary.rows.reduce((s, r) => s + r.allocated, 0);

  return (
    <div className="split-app" data-testid="margin-split">
      <div className="admin-summary">
        <div className="stat">
          <span className="stat-n" data-testid="pot-total">{pounds(summary.pot)}</span>
          <span className="stat-l">pot total</span>
        </div>
        <div className="stat">
          <span className="stat-n" data-testid="pot-drawn">{pounds(summary.drawn)}</span>
          <span className="stat-l">drawn</span>
        </div>
        <div className="stat">
          <span className="stat-n" data-testid="pot-remaining">{balance(summary.remaining)}</span>
          <span className="stat-l">pot remaining</span>
        </div>
      </div>

      <section className="card">
        <h2 className="card-title">Who is owed what</h2>
        <p className="card-note">
          The pot is split by share, largest remainder, so the allocations always add up to the pot
          to the penny.
        </p>
        <div className="table-scroll">
          <table className="staff-table" data-testid="summary-table">
            <thead>
              <tr>
                <th scope="col">Contractor</th>
                <th scope="col">Share</th>
                <th scope="col">Allocated</th>
                <th scope="col">Cash</th>
                <th scope="col">Transfer</th>
                <th scope="col">Drawn</th>
                <th scope="col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.contractor.id} data-testid={`row-${r.contractor.name}`}>
                  <th scope="row">{r.contractor.name}</th>
                  <td>{percent(r.contractor.shareBp)}</td>
                  <td data-testid="allocated">{pounds(r.allocated)}</td>
                  <td data-testid="cash">{pounds(r.cash)}</td>
                  <td data-testid="transfer">{pounds(r.transfer)}</td>
                  <td data-testid="drawn">{pounds(r.drawn)}</td>
                  <td data-testid="balance" className={r.balance < 0 ? "split-over" : undefined}>
                    {balance(r.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td />
                <td data-testid="allocated-total">{pounds(allocatedSum)}</td>
                <td colSpan={2} />
                <td data-testid="drawn-total">{pounds(summary.drawn)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Jobs</h2>
        <p className="card-note">Each job adds value × margin to the pot, rounded half-up to the penny.</p>
        {jobs.length === 0 ? (
          <p className="empty">No jobs yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="staff-table" data-testid="jobs-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Date</th>
                  <th scope="col">Value</th>
                  <th scope="col">Margin</th>
                  <th scope="col">To the pot</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <th scope="row">{j.name}</th>
                    <td>{j.jobDate}</td>
                    <td>{pounds(j.valuePence)}</td>
                    <td>{percent(j.marginBp)}</td>
                    <td>{pounds(contribution(j))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="split-sub">Add a job</h3>
        <ActionForm id="job" action={submitJob} label="Add job">
          <Field label="Name">
            <input type="text" name="name" required data-testid="job-name" />
          </Field>
          <Field label="Date">
            <input type="date" name="jobDate" required data-testid="job-date" />
          </Field>
          <Field label="Value £">
            <input type="text" inputMode="decimal" name="value" required data-testid="job-value" />
          </Field>
          <Field label="Margin %">
            <input type="text" inputMode="decimal" name="margin" required data-testid="job-margin" />
          </Field>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="card-title">Drawings</h2>
        {drawings.length === 0 ? (
          <p className="empty">No drawings yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="staff-table" data-testid="drawings-table">
              <thead>
                <tr>
                  <th scope="col">Contractor</th>
                  <th scope="col">Date</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Method</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {drawings.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{names.get(d.contractorId) ?? "—"}</th>
                    <td>{d.drawnOn}</td>
                    <td>{pounds(d.amountPence)}</td>
                    <td>{d.method === "cash" ? "Cash" : "Bank transfer"}</td>
                    <td>{d.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="split-sub">Add a drawing</h3>
        <ActionForm id="drawing" action={submitDrawing} label="Add drawing">
          <Field label="Contractor">
            <select name="contractorId" required data-testid="drawing-contractor">
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" name="drawnOn" required data-testid="drawing-date" />
          </Field>
          <Field label="Amount £">
            <input type="text" inputMode="decimal" name="amount" required data-testid="drawing-amount" />
          </Field>
          <Field label="Method">
            <select name="method" data-testid="drawing-method">
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </Field>
          <Field label="Note">
            <input type="text" name="note" data-testid="drawing-note" />
          </Field>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="card-title">Contractors and shares</h2>
        <p className="card-note">
          A contractor is a name, not a sign-in. Shares must total exactly 100% or nothing is saved.
        </p>
        <SharesForm key={contractors.map((c) => c.id).join()} contractors={contractors} />
        <h3 className="split-sub">Add a contractor</h3>
        <ActionForm id="contractor" action={submitContractor} label="Add contractor">
          <Field label="Name">
            <input type="text" name="name" required data-testid="contractor-name" />
          </Field>
        </ActionForm>
      </section>
    </div>
  );
}

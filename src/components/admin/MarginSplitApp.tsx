"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  deleteDrawing,
  deleteJob,
  submitContractors,
  submitDrawing,
  submitJob,
  type MsState,
} from "@/app/actions/margin-split";
import {
  WHOLE_BP,
  bpToInput,
  contribution,
  equalShares,
  formatBalance,
  formatBp,
  formatPence,
  parseBp,
  type MsContractor,
  type MsData,
  type MsSummary,
} from "@/lib/margin-split-calc";

const idle: MsState = { status: "idle" };

/**
 * The Margin Split screen. Styled with the Expenses classes rather than a set
 * of its own — the look of the page is ported, not invented (BLOCKED.md).
 *
 * Every figure shown is worked out on the server and passed in. The only
 * arithmetic here is the running total of the shares form, and the server
 * checks that again before anything is saved.
 */
export function MarginSplitApp({ data, summary }: { data: MsData; summary: MsSummary }) {
  const names = new Map(data.contractors.map((c) => [c.id, c.name]));

  return (
    <div className="exp-app ms-app" data-testid="ms-app">
      <p className="exp-quiet">
        <Link href="/admin">← Staff access</Link>
      </p>

      <section className="exp-card" aria-labelledby="ms-summary-h">
        <h2 className="exp-h" id="ms-summary-h">
          Summary
        </h2>
        <div className="admin-summary">
          <div className="stat">
            <span className="stat-n" data-testid="pot-total">
              {formatPence(summary.potPence)}
            </span>
            <span className="stat-l">pot total</span>
          </div>
          <div className="stat">
            <span className="stat-n" data-testid="drawn-total">
              {formatPence(summary.drawnPence)}
            </span>
            <span className="stat-l">drawn</span>
          </div>
          <div className="stat">
            <span className="stat-n" data-testid="pot-remaining">
              {formatBalance(summary.remainingPence)}
            </span>
            <span className="stat-l">pot remaining</span>
          </div>
        </div>

        <div className="exp-scroll">
          <table className="exp-table" data-testid="summary-table">
            <thead>
              <tr>
                <th scope="col">Contractor</th>
                <th scope="col">Share</th>
                <th scope="col" className="exp-num">Allocated</th>
                <th scope="col" className="exp-num">Cash</th>
                <th scope="col" className="exp-num">Transfer</th>
                <th scope="col" className="exp-num">Drawn</th>
                <th scope="col" className="exp-num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {summary.contractors.map((c) => (
                <tr key={c.id} data-testid={`sum-${c.id}`}>
                  <th scope="row">{c.name}</th>
                  <td>{formatBp(c.shareBp)}</td>
                  <td className="exp-num" data-testid={`alloc-${c.id}`}>
                    {formatPence(c.allocatedPence)}
                  </td>
                  <td className="exp-num" data-testid={`cash-${c.id}`}>
                    {formatPence(c.cashPence)}
                  </td>
                  <td className="exp-num" data-testid={`transfer-${c.id}`}>
                    {formatPence(c.transferPence)}
                  </td>
                  <td className="exp-num" data-testid={`drawn-${c.id}`}>
                    {formatPence(c.drawnPence)}
                  </td>
                  <td className="exp-num" data-testid={`balance-${c.id}`}>
                    {formatBalance(c.balancePence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="exp-card" aria-labelledby="ms-jobs-h">
        <h2 className="exp-h" id="ms-jobs-h">
          Jobs
        </h2>
        {data.jobs.length === 0 ? (
          <p className="exp-empty">No jobs yet. The pot is empty until one is added.</p>
        ) : (
          <div className="exp-scroll">
            <table className="exp-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="exp-num">Value</th>
                  <th scope="col" className="exp-num">Margin</th>
                  <th scope="col" className="exp-num">To the pot</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.id} data-testid={`job-${j.id}`}>
                    <td>{j.name}</td>
                    <td>{j.jobDate}</td>
                    <td className="exp-num">{formatPence(j.valuePence)}</td>
                    <td className="exp-num">{formatBp(j.marginBp)}</td>
                    <td className="exp-num" data-testid={`contribution-${j.id}`}>
                      {formatPence(contribution(j.valuePence, j.marginBp))}
                    </td>
                    <td className="exp-row-actions">
                      <RemoveButton action={deleteJob} id={j.id} testId={`remove-job-${j.id}`} label={j.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <JobForm />
      </section>

      <section className="exp-card" aria-labelledby="ms-contractors-h">
        <h2 className="exp-h" id="ms-contractors-h">
          Contractors
        </h2>
        <p className="exp-quiet">
          Shares must total exactly 100%. A contractor is a name, not a sign-in.
        </p>
        <ContractorsCard contractors={data.contractors} />
      </section>

      <section className="exp-card" aria-labelledby="ms-drawings-h">
        <h2 className="exp-h" id="ms-drawings-h">
          Drawings
        </h2>
        {data.drawings.length === 0 ? (
          <p className="exp-empty">Nothing drawn yet.</p>
        ) : (
          <div className="exp-scroll">
            <table className="exp-table">
              <thead>
                <tr>
                  <th scope="col">Contractor</th>
                  <th scope="col">Date</th>
                  <th scope="col">Method</th>
                  <th scope="col">Note</th>
                  <th scope="col" className="exp-num">Amount</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.drawings.map((d) => (
                  <tr key={d.id} data-testid={`drawing-${d.id}`}>
                    <td>{names.get(d.contractorId) ?? "—"}</td>
                    <td>{d.drawDate}</td>
                    <td>{d.method === "cash" ? "Cash" : "Bank transfer"}</td>
                    <td>{d.note ?? ""}</td>
                    <td className="exp-num">{formatPence(d.amountPence)}</td>
                    <td className="exp-row-actions">
                      <RemoveButton
                        action={deleteDrawing}
                        id={d.id}
                        testId={`remove-drawing-${d.id}`}
                        label={`drawing of ${formatPence(d.amountPence)}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DrawingForm contractors={data.contractors} />
      </section>
    </div>
  );
}

function Message({ state, prefix }: { state: MsState; prefix: string }) {
  if (state.status === "error") {
    return (
      <div className="msg" role="alert" data-testid={`${prefix}-error`}>
        {state.message}
      </div>
    );
  }
  if (state.status === "ok") {
    return (
      <div className="msg ok" role="status" data-testid={`${prefix}-ok`}>
        {state.message}
      </div>
    );
  }
  return null;
}

function RemoveButton({
  action,
  id,
  testId,
  label,
}: {
  action: (s: MsState, f: FormData) => Promise<MsState>;
  id: string;
  testId: string;
  label: string;
}) {
  const [state, run, pending] = useActionState(action, idle);
  return (
    <form action={run} className="exp-inline">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="quiet danger" disabled={pending} data-testid={testId}>
        Remove<span className="sr-only"> {label}</span>
      </button>
      {state.status === "error" ? (
        <span className="msg" role="alert" data-testid={`${testId}-error`}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function JobForm() {
  const [state, action, pending] = useActionState(submitJob, idle);
  return (
    <form action={action} className="exp-form" data-testid="job-form">
      <div className="exp-grid">
        <label className="field">
          <span className="field-label">Job</span>
          <input type="text" name="name" required data-testid="job-name" />
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" name="jobDate" required data-testid="job-date" />
        </label>
        <label className="field">
          <span className="field-label">Value (£)</span>
          <input type="text" inputMode="decimal" name="value" required placeholder="0.00" data-testid="job-value" />
        </label>
        <label className="field">
          <span className="field-label">Margin (%)</span>
          <input type="text" inputMode="decimal" name="margin" required placeholder="12.5" data-testid="job-margin" />
        </label>
      </div>
      <Message state={state} prefix="job" />
      <div className="exp-actions">
        <button type="submit" className="primary" disabled={pending} data-testid="job-submit">
          {pending ? "Saving…" : "Add job"}
        </button>
      </div>
    </form>
  );
}

type Row = { id: string; name: string; share: string };

/**
 * The action's state lives here, above the form, because the form is keyed on
 * what was saved: a successful save starts it again from the stored list rather
 * than from what was typed, and a remount would take the "saved" message with it.
 */
function ContractorsCard({ contractors }: { contractors: MsContractor[] }) {
  const [state, action, pending] = useActionState(submitContractors, idle);
  return (
    <ContractorsForm
      key={contractors.map((c) => `${c.id}:${c.name}:${c.shareBp}`).join("|")}
      contractors={contractors}
      state={state}
      action={action}
      pending={pending}
    />
  );
}

function ContractorsForm({
  contractors,
  state,
  action,
  pending,
}: {
  contractors: MsContractor[];
  state: MsState;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => [
    ...[...contractors]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name, share: bpToInput(c.shareBp) })),
    { id: "", name: "", share: "" },
  ]);

  const counted = rows.filter((r) => r.id || r.name.trim());
  const total = counted.reduce((s, r) => s + (parseBp(r.share || "0") ?? NaN), 0);
  const balanced = total === WHOLE_BP;

  const update = (i: number, patch: Partial<Row>) =>
    setRows((all) => {
      const next = all.map((r, j) => (j === i ? { ...r, ...patch } : r));
      // Always one empty line at the bottom to add somebody on.
      const last = next[next.length - 1];
      return last.id || last.name ? [...next, { id: "", name: "", share: "" }] : next;
    });

  const splitEqually = () => {
    const shares = equalShares(counted.length);
    let k = 0;
    setRows((all) =>
      all.map((r) => (r.id || r.name.trim() ? { ...r, share: bpToInput(shares[k++]) } : r)),
    );
  };

  return (
    <form action={action} className="exp-form" data-testid="contractors-form">
      {rows.map((r, i) => (
        <div className="exp-grid" key={i}>
          <input type="hidden" name="id" value={r.id} />
          <label className="field">
            <span className="field-label">{r.id ? `Contractor ${i + 1}` : "Add a contractor"}</span>
            <input
              type="text"
              name="name"
              value={r.name}
              onChange={(e) => update(i, { name: e.target.value })}
              data-testid={`contractor-name-${i}`}
            />
          </label>
          <label className="field">
            <span className="field-label">Share (%)</span>
            <input
              type="text"
              inputMode="decimal"
              name="share"
              value={r.share}
              onChange={(e) => update(i, { share: e.target.value })}
              data-testid={`contractor-share-${i}`}
            />
          </label>
        </div>
      ))}
      <p className="exp-preview" data-testid="contractors-total">
        {Number.isNaN(total)
          ? "A share is not a percentage to two decimal places."
          : `Shares total ${(total / 100).toFixed(2)}%${balanced ? "." : " — they must total exactly 100%."}`}
      </p>
      <Message state={state} prefix="contractors" />
      <div className="exp-actions">
        <button type="button" className="quiet" onClick={splitEqually} data-testid="split-equally">
          Split equally
        </button>
        <button type="submit" className="primary" disabled={pending} data-testid="contractors-save">
          {pending ? "Saving…" : "Save contractors"}
        </button>
      </div>
    </form>
  );
}

function DrawingForm({ contractors }: { contractors: MsContractor[] }) {
  const [state, action, pending] = useActionState(submitDrawing, idle);
  return (
    <form action={action} className="exp-form" data-testid="drawing-form">
      <div className="exp-grid">
        <label className="field">
          <span className="field-label">Contractor</span>
          <select name="contractorId" required defaultValue="" data-testid="draw-contractor">
            <option value="" disabled>
              Choose…
            </option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" name="drawDate" required data-testid="draw-date" />
        </label>
        <label className="field">
          <span className="field-label">Amount (£)</span>
          <input type="text" inputMode="decimal" name="amount" required placeholder="0.00" data-testid="draw-amount" />
        </label>
        <label className="field">
          <span className="field-label">Method</span>
          <select name="method" defaultValue="bank_transfer" data-testid="draw-method">
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
          </select>
        </label>
        <label className="field exp-wide">
          <span className="field-label">Note</span>
          <input type="text" name="note" data-testid="draw-note" />
        </label>
      </div>
      <Message state={state} prefix="draw" />
      <div className="exp-actions">
        <button type="submit" className="primary" disabled={pending} data-testid="draw-submit">
          {pending ? "Saving…" : "Add drawing"}
        </button>
      </div>
    </form>
  );
}

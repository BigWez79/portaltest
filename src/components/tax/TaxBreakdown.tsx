"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULTS,
  STORAGE_KEY,
  TAX_YEAR,
  calculate,
  fmt,
  fmtSigned,
  fromStored,
  toStored,
  type StoredInputs,
  type TaxState,
} from "@/lib/tax-model";

/**
 * Tax Breakdown, ported from `taxbreakdown.html` on the live suite.
 *
 * What changed and what did not:
 *
 * - **The sign-in went.** The live page carries MSAL, a hard-coded Entra client
 *   id and tenant id, a redirect handler and a Sign out button of its own — in
 *   front of a calculator that never calls Graph (`SCOPES` is `User.Read` and
 *   nothing else). None of it is here: the person is signed in and holds
 *   `has_tax_breakdown`, or `requireApp` never rendered this. That also takes
 *   an app registration id off a public page.
 * - **Nothing is fetched.** MSAL was the only off-site script and Google Fonts
 *   the only off-site stylesheet; Sora and Albert Sans are self-hosted here.
 *   `tests/tax-breakdown.spec.ts` asserts the page makes no off-site request and
 *   that the string `msal` appears nowhere in what is served.
 * - **The sums did not change.** They live in `src/lib/tax-model.ts` and are
 *   checked against the live page's own output in the suite.
 * - **The statutory rates did not change either** — see the note at the top of
 *   the model. Only the default *inputs* became placeholders.
 * - Saved figures still live in this browser under the same key,
 *   `paTaxBreakdownInputs_v1`, in the same shape, so a browser that has used the
 *   live page keeps them. Moving them to Postgres is a separate decision.
 *
 * State is read from localStorage in an effect rather than during render, so the
 * server-rendered markup and the first client render agree.
 */

function readStore(): Partial<StoredInputs> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Partial<StoredInputs>;
  } catch {
    /* storage blocked — the calculator still works, it just does not remember */
  }
  return null;
}

/** The money boxes, in the order they appear. */
type MoneyField = {
  key: keyof TaxState;
  label: string;
  hint?: string;
  step?: string;
};

export function TaxBreakdown() {
  const [state, setState] = useState<TaxState>(() => fromStored(DEFAULTS));
  const [hydrated, setHydrated] = useState(false);
  const [edits, setEdits] = useState(0);
  const [saveStatus, setSaveStatus] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Restore whatever this browser had, once, after mount. */
  useEffect(() => {
    const stored = readStore();
    if (stored) setState(fromStored(stored));
    setHydrated(true);
  }, []);

  const patch = useCallback((change: Partial<TaxState>) => {
    setState((s) => ({ ...s, ...change }));
    setEdits((n) => n + 1);
  }, []);

  /* Saved half a second after typing stops, as on the live page. */
  useEffect(() => {
    if (edits === 0) return;
    setSaveStatus("Saving…");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toStored(state)));
        setSaveStatus("✓ Saved to this browser");
      } catch {
        setSaveStatus("⚠ Save failed");
      }
    }, 500);
  }, [state, edits]);

  useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), []);

  const reset = () => {
    if (!window.confirm("Reset all figures to defaults? This clears your saved data.")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setState(fromStored(DEFAULTS));
    setEdits(0);
    setSaveStatus("");
  };

  const r = useMemo(() => calculate(state), [state]);

  const money = (f: MoneyField) => (
    <div className="field" key={String(f.key)}>
      <label htmlFor={`tax-${String(f.key)}`}>{f.label}</label>
      <input
        type="number"
        id={`tax-${String(f.key)}`}
        data-testid={String(f.key)}
        min="0"
        step={f.step ?? "100"}
        value={state[f.key] as string}
        onChange={(e) => patch({ [f.key]: e.target.value } as Partial<TaxState>)}
      />
      {f.hint ? <div className="hint">{f.hint}</div> : null}
    </div>
  );

  const directorCard = (
    which: "A" | "B",
    num: string,
    nameKey: "nameA" | "nameB",
    fields: MoneyField[],
    mileage: number,
  ) => (
    <div className="card">
      <h2>
        <span className="num">{num}</span>
        <span data-testid={`name${which}Label`}>{state[nameKey] || `Director ${which}`}</span>
      </h2>
      <input
        className="director-name-input"
        aria-label={`Director ${which} name`}
        data-testid={nameKey}
        value={state[nameKey]}
        onChange={(e) => patch({ [nameKey]: e.target.value } as Partial<TaxState>)}
      />
      {money(fields[0])}
      {money(fields[1])}
      {money(fields[2])}
      <div className="mileage-result">
        Mileage claim: <strong data-testid={`mileage${which}Result`}>{fmt(mileage)}</strong>{" "}
        (tax-free, deducted from profit)
      </div>
      <div className="sub-heading">External income</div>
      {money(fields[3])}
    </div>
  );

  return (
    <div
      className="tax-app"
      data-testid="tax-calculator"
      /* The suite waits on this: the first paint shows the defaults, and what
         this browser had saved arrives an effect later. */
      data-hydrated={hydrated ? "1" : "0"}
    >
      <div className="toolbar">
        <div>
          <label className="sr-only" htmlFor="tax-companyName">
            Company name
          </label>
          <input
            className="company-input"
            id="tax-companyName"
            data-testid="companyName"
            value={state.companyName}
            onChange={(e) => patch({ companyName: e.target.value })}
          />
        </div>
        <div className="toolbar-right">
          <div className="save-status" data-testid="tax-save-status" aria-live="polite">
            {saveStatus || " "}
          </div>
          <button type="button" className="btn-reset" data-testid="tax-reset" onClick={reset}>
            Reset
          </button>
          <div className="tax-year-tag" data-testid="tax-year">
            TAX YEAR {TAX_YEAR}
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>
            <span className="num">01</span> Income &amp; expenses
          </h2>
          {money({ key: "revenue", label: "Annual revenue" })}
          {money({
            key: "generalExpenses",
            label: "General business expenses",
            hint: "Software, insurance, office costs etc.",
          })}
          {money({
            key: "travelExpenses",
            label: "Travel expenses",
            hint: "Hotels, subsistence, rail/air — mileage is calculated separately below",
          })}
          {money({ key: "otherExpenses", label: "Other allowable expenses" })}
          <div className="sub-heading">Mileage rate (HMRC AMAP)</div>
          <div className="two-col">
            {money({ key: "mileageRateFirst", label: "First 10,000 miles (p)", step: "1" })}
            {money({ key: "mileageRateAfter", label: "Over 10,000 miles (p)", step: "1" })}
          </div>
        </div>

        {directorCard(
          "A",
          "02",
          "nameA",
          [
            { key: "salaryA", label: "Gross annual salary" },
            {
              key: "pensionA",
              label: "Employer pension contribution",
              hint: "Paid by company, deductible, no NI",
            },
            { key: "milesA", label: "Business miles claimed this year" },
            {
              key: "otherIncomeA",
              label: "Other PAYE salary (another job)",
              hint: "Not part of this company's accounts — used only to position their tax bands correctly",
            },
          ],
          r.directors[0].mileage,
        )}

        {directorCard(
          "B",
          "03",
          "nameB",
          [
            { key: "salaryB", label: "Gross annual salary" },
            {
              key: "pensionB",
              label: "Employer pension contribution",
              hint: "Paid by company, deductible, no NI",
            },
            { key: "milesB", label: "Business miles claimed this year" },
            {
              key: "otherIncomeB",
              label: "Other PAYE salary (another job)",
              hint: "Not part of this company's accounts — used only to position their tax bands correctly",
            },
          ],
          r.directors[1].mileage,
        )}

        <div className="card">
          <h2>
            <span className="num">04</span> Dividend policy
          </h2>
          <div className="slider-row">
            <label htmlFor="tax-payoutPct">
              Payout of post-tax profit as dividends:{" "}
              <span className="value" data-testid="payoutPctValue">
                {state.payoutPct}%
              </span>
            </label>
            <input
              type="range"
              id="tax-payoutPct"
              data-testid="payoutPct"
              min="0"
              max="100"
              value={state.payoutPct}
              onChange={(e) => patch({ payoutPct: Number(e.target.value) })}
            />
          </div>
          <div className="slider-row" style={{ marginTop: 18 }}>
            <label htmlFor="tax-splitA">
              Split to{" "}
              <span data-testid="splitALabel">{state.nameA || "Director A"}</span>:{" "}
              <span className="value" data-testid="splitAValue">
                {state.splitA}%
              </span>
            </label>
            <input
              type="range"
              id="tax-splitA"
              data-testid="splitA"
              min="0"
              max="100"
              value={state.splitA}
              onChange={(e) => patch({ splitA: Number(e.target.value) })}
            />
            <div className="split-labels">
              <span data-testid="splitALine">
                {(state.nameA || "A") + ": " + state.splitA + "%"}
              </span>
              <span data-testid="splitBLine">
                {(state.nameB || "B") + ": " + (100 - state.splitA) + "%"}
              </span>
            </div>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              data-testid="employmentAllowance"
              checked={state.employmentAllowance}
              onChange={(e) => patch({ employmentAllowance: e.target.checked })}
            />
            Claim Employment Allowance (up to £10,500 off employer NI)
          </label>
        </div>
      </div>

      <div className="ledger">
        <h3>Profit &amp; tax ledger</h3>
        <div className="sub">Revenue down to retained profit</div>
        <div data-testid="ledgerRows">
          {r.ledger.map((line) => (
            <div
              className={line.subtotal ? "ledger-row total" : "ledger-row"}
              key={line.label}
              data-testid="ledger-row"
            >
              <span data-testid="ledger-label">{line.label}</span>
              <span
                className={line.value < 0 ? "neg" : line.subtotal ? "" : "pos"}
                data-testid="ledger-value"
              >
                {fmtSigned(line.value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="summary-grid" data-testid="summaryGrid">
        <div className="stat-card tax" data-testid="stat-card">
          <div className="stat-label" data-testid="stat-label">
            Corporation Tax
          </div>
          <div className="stat-value" data-testid="stat-value">
            {fmt(r.ct.tax)}
          </div>
          <div className="stat-detail" data-testid="stat-detail">
            {r.ct.band}
            {r.ct.marginalRelief > 0 ? ` · relief ${fmt(r.ct.marginalRelief)}` : ""}
          </div>
        </div>
        <div className="stat-card tax" data-testid="stat-card">
          <div className="stat-label" data-testid="stat-label">
            Total tax &amp; NI (company + personal)
          </div>
          <div className="stat-value" data-testid="stat-value">
            {fmt(r.totalTax)}
          </div>
          <div className="stat-detail" data-testid="stat-detail">
            {r.effectiveRate.toFixed(1)}% of revenue
          </div>
        </div>
        <div className="stat-card takehome" data-testid="stat-card">
          <div className="stat-label" data-testid="stat-label">
            Combined take-home (both directors)
          </div>
          <div className="stat-value" data-testid="stat-value">
            {fmt(r.combinedTakeHome)}
          </div>
          <div className="stat-detail" data-testid="stat-detail">
            After all salary &amp; dividend tax
          </div>
        </div>
        <div className="stat-card" data-testid="stat-card">
          <div className="stat-label" data-testid="stat-label">
            Retained in company
          </div>
          <div className="stat-value" data-testid="stat-value">
            {fmt(r.retainedProfit)}
          </div>
          <div className="stat-detail" data-testid="stat-detail">
            Undistributed post-tax profit
          </div>
        </div>
      </div>

      <div className="director-results" data-testid="directorResults">
        {r.directors.map((d, i) => (
          <div className="card dr-card" key={i} data-testid="dr-card">
            <h3 data-testid="dr-name">{d.name}</h3>
            {d.otherIncome > 0 ? (
              <div className="dr-line other" data-testid="dr-line">
                <span data-testid="dr-label">Other PAYE income (external, informational)</span>
                <span data-testid="dr-value">{fmt(d.otherIncome)}</span>
              </div>
            ) : null}
            <div className="dr-line" data-testid="dr-line">
              <span data-testid="dr-label">Gross salary</span>
              <span data-testid="dr-value">{fmt(d.salary)}</span>
            </div>
            <div className="dr-line deduct" data-testid="dr-line">
              <span data-testid="dr-label">Income tax on this company&apos;s salary</span>
              <span data-testid="dr-value">-{fmt(d.tax.incomeTax)}</span>
            </div>
            <div className="dr-line deduct" data-testid="dr-line">
              <span data-testid="dr-label">Employee NI</span>
              <span data-testid="dr-value">-{fmt(d.tax.employeeNI)}</span>
            </div>
            <div className="dr-line" data-testid="dr-line">
              <span data-testid="dr-label">Dividends received</span>
              <span data-testid="dr-value">{fmt(d.dividend)}</span>
            </div>
            <div className="dr-line deduct" data-testid="dr-line">
              <span data-testid="dr-label">Dividend tax</span>
              <span data-testid="dr-value">-{fmt(d.tax.dividendTax)}</span>
            </div>
            <div className="dr-line" data-testid="dr-line">
              <span data-testid="dr-label">Employer pension (not personal income)</span>
              <span data-testid="dr-value">{fmt(d.pension)}</span>
            </div>
            <div className="dr-line final" data-testid="dr-line">
              <span data-testid="dr-label">Net take-home</span>
              <span data-testid="dr-value">{fmt(d.takeHome)}</span>
            </div>
            <div className="bar-track">
              {/* The percentage itself, not just its width: a bar cannot be
                  asserted on, and the suite pins this against the live page. */}
              <div
                className="bar-fill good"
                data-testid="dr-bar"
                data-pct={String(Math.max(0, Math.min(100, d.takeHomePct)))}
                style={{ width: `${Math.max(0, Math.min(100, d.takeHomePct))}%` }}
              />
              <div className="bar-fill rest" />
            </div>
          </div>
        ))}
      </div>

      <div className="note">
        Figures use {TAX_YEAR} rates: Corporation Tax 19% (profits ≤£50,000) / 25% (≥£250,000) with
        marginal relief between; dividend allowance £500 with basic/higher/additional rates of
        10.75% / 35.75% / 39.35%; personal allowance £12,570 (tapered to nil between
        £100,000–£125,140 of total income); employee NI 8%/2%; employer NI 15% above £5,000 per
        employee; mileage per HMRC AMAP rates. Where &ldquo;other PAYE income&rdquo; is entered,
        it&rsquo;s stacked first when working out tax bands and the personal allowance taper — it
        isn&rsquo;t part of this company&rsquo;s accounts, but it does push dividend income into
        higher tax bands. Employee NI is still calculated per employment independently. This is a
        planning tool, not a substitute for advice from an accountant — it assumes dividends
        declared in the same year profit is earned. Figures are saved to this browser only.
      </div>
    </div>
  );
}

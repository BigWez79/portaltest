"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRESET,
  SCENARIO_KEY,
  STORE_KEY,
  blankItem,
  blankStaff,
  calculate,
  clampSplit,
  formatStamp,
  fromStored,
  gbp,
  toStored,
  type ItemKey,
  type ItemLine,
  type MarginState,
  type OwnerKey,
  type Period,
  type Scenario,
  type StaffLine,
  type StoredState,
} from "@/lib/margin-model";
import { downloadMarginPdf } from "./margin-pdf";

/**
 * Margin & Profit Split, ported from `margin.html` on the live suite.
 *
 * What changed and what did not:
 *
 * - The sums did not. They live in `src/lib/margin-model.ts` and are checked
 *   against the live page's own output in `tests/margin.spec.ts`.
 * - The default figures did. The live page ships a real quarter's revenue, a
 *   real split and a real debt to a named person, on a page with no sign-in in
 *   a public repository. See PRESET.
 * - jsPDF and jspdf-autotable are bundled instead of pulled from cdnjs.
 * - Saved values still live in the browser under the same two keys, in the same
 *   shape, so nothing anyone has saved on the live page is lost. Moving them to
 *   Postgres is a separate decision (TASKS.md P1).
 *
 * State is read from localStorage in an effect rather than during render, so
 * the server-rendered markup and the first client render agree.
 */

const OWNER_OPTIONS: Array<{ value: "" | OwnerKey; label: string }> = [
  { value: "", label: "—" },
  { value: "A", label: "A" },
  { value: "B", label: "B" },
];

const ITEM_PLACEHOLDER: Record<ItemKey, string> = {
  carry: "e.g. Loan / capital in",
  inv: "e.g. New equipment",
  debtA: "e.g. Loan / capital in",
  debtB: "e.g. Loan / capital in",
};

function readStore(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as StoredState;
  } catch {
    /* storage blocked — the calculator still works, it just does not remember */
  }
  return null;
}

function readScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(SCENARIO_KEY);
    if (raw) return JSON.parse(raw) as Scenario[];
  } catch {
    /* as above */
  }
  return [];
}

function writeScenarios(list: Scenario[]) {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(list));
  } catch {
    /* as above */
  }
}

export function MarginCalculator() {
  const [state, setState] = useState<MarginState>(() => fromStored(PRESET));
  const [period, setPeriod] = useState<Period>("quarter");
  const [hydrated, setHydrated] = useState(false);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scName, setScName] = useState("");
  const [scSelected, setScSelected] = useState("");
  const [scStamp, setScStamp] = useState("");

  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Restore whatever this browser had, once, after mount. */
  useEffect(() => {
    const stored = readStore();
    if (stored) setState(fromStored(stored));
    setScenarios(readScenarios());
    setHydrated(true);
  }, []);

  /* Every edit is saved, as on the live page. */
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(toStored(state)));
    } catch {
      return; // storage blocked: nothing saved, so do not claim it was
    }
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  }, [state, hydrated]);

  useEffect(() => () => void (savedTimer.current && clearTimeout(savedTimer.current)), []);

  const r = useMemo(() => calculate(state, period), [state, period]);

  /* ------------------------------ edit helpers ----------------------------- */

  const patch = useCallback(
    (change: Partial<MarginState>) => setState((s) => ({ ...s, ...change })),
    [],
  );

  const setSplit = useCallback((v: number) => patch({ split: clampSplit(v) }), [patch]);

  const editStaff = (id: string, change: Partial<StaffLine>) =>
    setState((s) => ({
      ...s,
      staff: s.staff.map((row) => (row.id === id ? { ...row, ...change } : row)),
    }));

  const removeStaff = (id: string) =>
    setState((s) => ({ ...s, staff: s.staff.filter((row) => row.id !== id) }));

  const editItem = (key: ItemKey, id: string, change: Partial<ItemLine>) =>
    setState((s) => ({
      ...s,
      [key]: s[key].map((row) => (row.id === id ? { ...row, ...change } : row)),
    }));

  const removeItem = (key: ItemKey, id: string) =>
    setState((s) => ({ ...s, [key]: s[key].filter((row) => row.id !== id) }));

  const addItem = (key: ItemKey) => setState((s) => ({ ...s, [key]: [...s[key], blankItem()] }));

  const reset = () => {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* nothing to clear */
    }
    setState(fromStored(PRESET));
    setScStamp("Figures reset to the placeholder presets.");
  };

  /* ------------------------------- scenarios ------------------------------- */

  const saveScenario = () => {
    const name = scName.trim();
    if (!name) return;
    const list = readScenarios();
    const nowIso = new Date().toISOString();
    const data = toStored(state);
    const existing = list.find((s) => s.name.toLowerCase() === name.toLowerCase());
    let id: string;
    if (existing) {
      existing.savedAt = nowIso;
      existing.data = data;
      id = existing.id;
    } else {
      id = `sc_${nowIso.replace(/[^0-9]/g, "")}_${list.length + 1}`;
      list.push({ id, name, savedAt: nowIso, data });
    }
    writeScenarios(list);
    setScenarios(list);
    setScSelected(id);
    setScStamp(`Saved “${name}” at ${formatStamp(nowIso)}`);
  };

  const loadScenario = () => {
    const s = scenarios.find((x) => x.id === scSelected);
    if (!s) return;
    setState(fromStored(s.data));
    setScName(s.name);
    setScStamp(`Loaded “${s.name}” — saved ${formatStamp(s.savedAt)}`);
  };

  const deleteScenario = () => {
    if (!scSelected) return;
    const list = readScenarios().filter((x) => x.id !== scSelected);
    writeScenarios(list);
    setScenarios(list);
    setScSelected("");
    setScStamp("Scenario deleted.");
  };

  const downloadPdf = async () => {
    try {
      await downloadMarginPdf(r, scName || "Scenario");
      setScStamp(`PDF downloaded for “${scName.trim() || "Scenario"}”.`);
    } catch {
      setScStamp("The PDF could not be built. Try again.");
    }
  };

  /* --------------------------------- render -------------------------------- */

  const ordered = useMemo(
    () => scenarios.slice().sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || "")),
    [scenarios],
  );

  const itemBlock = (key: ItemKey, addLabel: string) => (
    <>
      <div data-testid={`${key}List`}>
        {state[key].map((item) => (
          <div className="row item-row" key={item.id} data-testid={`${key}-row`}>
            <input
              type="text"
              className="i-name"
              placeholder={ITEM_PLACEHOLDER[key]}
              aria-label="Description"
              value={item.name}
              onChange={(e) => editItem(key, item.id, { name: e.target.value })}
            />
            <div className="prefix">
              <span>£</span>
              <input
                type="number"
                className="i-amt"
                placeholder="0"
                step="100"
                aria-label="Amount"
                value={item.amount}
                onChange={(e) => editItem(key, item.id, { amount: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="del"
              title="Remove"
              aria-label="Remove this line"
              onClick={() => removeItem(key, item.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="add" data-testid={`add-${key}`} onClick={() => addItem(key)}>
        {addLabel}
      </button>
    </>
  );

  return (
    <div className="margin-app" data-testid="margin-calculator">
      <p className="lede">
        Set quarterly revenue, deduct staff costs (day rate × days billed across the three months)
        to get your operating margin, then take out investments and debts. What&rsquo;s left is
        split between the owners.
      </p>

      <div className="toolbar">
        <div className="period-toggle" role="group" aria-label="Period">
          <button
            type="button"
            className={period === "quarter" ? "active" : ""}
            aria-pressed={period === "quarter"}
            data-testid="period-quarter"
            onClick={() => setPeriod("quarter")}
          >
            Quarterly view
          </button>
          <button
            type="button"
            className={period === "annual" ? "active" : ""}
            aria-pressed={period === "annual"}
            data-testid="period-annual"
            onClick={() => setPeriod("annual")}
          >
            Annual view
          </button>
        </div>
        <div className="tools">
          <span className={saved ? "saved show" : "saved"} data-testid="saved-flag">
            Saved ✓
          </span>
          <button
            type="button"
            className="btn-reset"
            data-testid="margin-reset"
            title="Discard changes and restore the preset values"
            onClick={reset}
          >
            Reset to presets
          </button>
        </div>
      </div>

      <div className="scbar">
        <div className="grp">
          <label htmlFor="scName">Scenario</label>
          <input
            type="text"
            id="scName"
            data-testid="sc-name"
            placeholder="e.g. Q1 2026"
            value={scName}
            onChange={(e) => setScName(e.target.value)}
          />
          <button
            type="button"
            className="btn-sc primary"
            data-testid="sc-save"
            title="Save the current figures as a named scenario"
            onClick={saveScenario}
          >
            Save scenario
          </button>
        </div>
        <div className="grp">
          <label htmlFor="scSelect">Saved</label>
          <select
            id="scSelect"
            data-testid="sc-select"
            value={scSelected}
            onChange={(e) => setScSelected(e.target.value)}
          >
            {ordered.length === 0 ? <option value="">— none saved —</option> : null}
            {ordered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {"  ·  "}
                {formatStamp(s.savedAt)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-sc ghost"
            data-testid="sc-load"
            title="Load the selected scenario"
            onClick={loadScenario}
          >
            Load
          </button>
          <button
            type="button"
            className="btn-sc ghost danger"
            data-testid="sc-delete"
            title="Delete the selected scenario"
            onClick={deleteScenario}
          >
            Delete
          </button>
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="btn-sc pdf"
          data-testid="sc-pdf"
          title="Download the current figures as a PDF report"
          onClick={downloadPdf}
        >
          Download PDF
        </button>
        <div className="sc-stamp" data-testid="sc-stamp" role="status">
          {scStamp}
        </div>
      </div>

      <div className="margin-grid">
        {/* ------------------------- Revenue and staff ------------------------- */}
        <section className="card">
          <h2>
            Revenue &amp; Staff <span className="tag">operating margin</span>
          </h2>

          <div className="date-row">
            <div>
              <label htmlFor="startDate">Quarter start date</label>
              <input
                type="date"
                id="startDate"
                data-testid="startDate"
                value={state.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
              />
            </div>
            <div className="wdbox">
              <div className="k">Working days in quarter</div>
              <div className="v" data-testid="workingDays">
                {r.quarter ? `${r.quarter.total} days` : "–"}
              </div>
              <div className="r" data-testid="quarterRange">
                {r.quarterRange}
              </div>
            </div>
          </div>

          <label htmlFor="revenue">Revenue (per quarter, fixed)</label>
          <div className="prefix">
            <span>£</span>
            <input
              type="number"
              id="revenue"
              data-testid="revenue"
              step="1000"
              value={state.revenue}
              onChange={(e) => patch({ revenue: e.target.value })}
            />
          </div>
          <div className="mini">
            Full year → <b data-testid="revAnnual">{gbp(r.revAnnualBase)}</b> (×4 quarters)
          </div>

          <div className="staff-block">
            {/* Seven columns will not fit a phone. The block scrolls inside
                itself so the page never scrolls sideways — see widths.spec. */}
            <div className="staff-scroll">
              <div className="staff-grid">
                <div className="row staff-row staff-head">
                  <div className="colhead l">
                    Staff member
                    <small>toggle = 50/50 · A/B = credit to owner</small>
                  </div>
                  <div className="colhead l">Day rate</div>
                  {[0, 1, 2].map((i) => (
                    <div className="colhead" key={i} data-testid={`colM${i + 1}`}>
                      {r.quarter ? `${r.quarter.segs[i].label} days` : `M${i + 1}`}
                      <small>{r.quarter ? `${r.quarter.segs[i].days} avail` : " "}</small>
                    </div>
                  ))}
                  <div className="colhead">Days</div>
                  <div className="colhead r">Qtr cost</div>
                </div>

                <div data-testid="staffList">
                  {state.staff.map((row, i) => {
                    const out = r.rows[i];
                    return (
                      <div className="row staff-row" key={row.id} data-testid="staff-row">
                        <div className="name-cell">
                          <label className="switch" title="Split this person's unclaimed days 50/50 between the owners">
                            <input
                              type="checkbox"
                              className="s-fifty"
                              data-testid="s-fifty"
                              checked={row.fifty}
                              onChange={(e) => editStaff(row.id, { fifty: e.target.checked })}
                            />
                            <span className="sl" />
                            <span className="sr-only">Split unclaimed days 50/50</span>
                          </label>
                          <input
                            type="text"
                            className="s-name"
                            data-testid="s-name"
                            aria-label="Staff member"
                            value={row.name}
                            onChange={(e) => editStaff(row.id, { name: e.target.value })}
                          />
                          <select
                            className={out.owner ? "s-owner on" : "s-owner"}
                            data-testid="s-owner"
                            aria-label="Credit this line to an owner"
                            title="Credit this line to an owner (paid to them off the top)"
                            value={row.owner}
                            onChange={(e) =>
                              editStaff(row.id, { owner: e.target.value as "" | OwnerKey })
                            }
                          >
                            {OWNER_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="s-del"
                            data-testid="s-del"
                            title="Remove this staff line"
                            aria-label="Remove this staff line"
                            onClick={() => removeStaff(row.id)}
                          >
                            ×
                          </button>
                        </div>

                        <div className="prefix">
                          <span>£</span>
                          <input
                            type="number"
                            className="s-rate"
                            data-testid="s-rate"
                            aria-label="Day rate"
                            step="10"
                            value={row.rate}
                            onChange={(e) => editStaff(row.id, { rate: e.target.value })}
                          />
                        </div>

                        {(["m1", "m2", "m3"] as const).map((k, mi) => (
                          <input
                            key={k}
                            type="number"
                            className={`s-${k}`}
                            data-testid={`s-${k}`}
                            aria-label={`Days billed in month ${mi + 1}`}
                            step="1"
                            min="0"
                            value={row[k]}
                            onChange={(e) => editStaff(row.id, { [k]: e.target.value })}
                          />
                        ))}

                        <div
                          className="s-days"
                          data-testid="s-days"
                          style={out.overbooked ? { color: "var(--err)" } : undefined}
                        >
                          {out.days}
                        </div>

                        <div className="s-qcost">
                          <div className="qc-cost" data-testid="qc-cost">
                            {gbp(out.cost)}
                          </div>
                          {out.owner ? (
                            <div className="qc-owner" data-testid="qc-owner">
                              → credited to {out.owner === "A" ? r.nameA : r.nameB}
                            </div>
                          ) : null}
                          {out.fiftyValue > 0 ? (
                            <div className="qc-fifty" data-testid="qc-fifty">
                              {out.fiftyDays}d × {gbp(out.rate)} = {gbp(out.fiftyValue)} (50/50)
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn-addstaff"
              data-testid="add-staff"
              onClick={() => setState((s) => ({ ...s, staff: [...s.staff, blankStaff()] }))}
            >
              + Add staff line
            </button>

            <div className="sub">
              <span>
                Total staff cost{" "}
                <span data-testid="staffPeriodLabel">
                  {period === "quarter" ? "(per quarter)" : "(full year)"}
                </span>{" "}
                <span style={{ color: "var(--muted)" }}>— business only</span>
              </span>
              <b data-testid="staffTotal">{gbp(r.staff)}</b>
            </div>
            {r.credA > 0 ? (
              <div className="sub no-rule" data-testid="credARow">
                <span>Credited to {r.nameA} (their staff line)</span>
                <b data-testid="credA">{gbp(r.credA)}</b>
              </div>
            ) : null}
            {r.credB > 0 ? (
              <div className="sub no-rule" data-testid="credBRow">
                <span>Credited to {r.nameB} (their staff line)</span>
                <b data-testid="credB">{gbp(r.credB)}</b>
              </div>
            ) : null}
            <div className="sub no-rule">
              <span>Total staff days worked (all staff)</span>
              <b data-testid="staffDays">{r.totalDays}</b>
            </div>
            <div className="sub no-rule">
              <span>Working days available per person</span>
              <b data-testid="availDays">{r.availTotal}</b>
            </div>
          </div>
        </section>

        {/* ------------------- Carryover, investments, debts ------------------- */}
        <section className="card">
          <h2>
            Carryover <span className="tag">adds to revenue</span>
          </h2>
          {itemBlock("carry", "+ Add carryover")}
          <div className="sub">
            <span>Total carryover</span>
            <b data-testid="carryTotal">{gbp(r.carryTotal)}</b>
          </div>

          <h2 className="stacked">
            Investments <span className="tag">deducted from margin</span>
          </h2>
          {itemBlock("inv", "+ Add investment")}
          <div className="sub">
            <span>Total investments</span>
            <b data-testid="invTotal">{gbp(r.invTotal)}</b>
          </div>

          <h2 className="stacked">
            Debts to {r.nameA} <span className="tag">added to their share</span>
          </h2>
          {itemBlock("debtA", "+ Add debt")}
          <div className="sub">
            <span>Total owed to {r.nameA}</span>
            <b data-testid="debtATotal">{gbp(r.debtATotal)}</b>
          </div>

          <h2 className="stacked">
            Debts to {r.nameB} <span className="tag">added to their share</span>
          </h2>
          {itemBlock("debtB", "+ Add debt")}
          <div className="sub">
            <span>Total owed to {r.nameB}</span>
            <b data-testid="debtBTotal">{gbp(r.debtBTotal)}</b>
          </div>

          <p className="note">
            Investments are deducted from the margin. Debts to an owner are <b>not</b> deducted —
            they&rsquo;re paid back on top of that owner&rsquo;s profit share.
          </p>
        </section>
      </div>

      {/* -------------------------------- Results ------------------------------- */}
      <div className="results">
        <div className="kpis">
          <div className="kpi accent">
            <div className="k">Revenue</div>
            <div className="v" data-testid="kRev">
              {gbp(r.rev)}
            </div>
            <div className="q" data-testid="kRevQ">
              {r.periodLabel}
            </div>
          </div>
          <div className="kpi warn">
            <div className="k">Staff cost</div>
            <div className="v" data-testid="kStaff">
              {gbp(r.staff)}
            </div>
            <div className="q">{r.periodLabel}</div>
          </div>
          <div className="kpi good">
            <div className="k">Operating margin</div>
            <div className="v" data-testid="kMargin">
              {gbp(r.margin)}
            </div>
            <div className="q" data-testid="kMarginPc">
              {r.marginPc.toFixed(1)}% margin
            </div>
          </div>
          <div className="kpi">
            <div className="k">Distributable profit</div>
            <div className="v" data-testid="kNet">
              {gbp(r.net)}
            </div>
            <div className="q">after investments</div>
          </div>
        </div>

        <section className="card split-card">
          <h2>
            Profit Split <span className="tag">adjustable</span>
          </h2>

          <div className="waterfall">
            <div className="wf">
              <span>Revenue</span>
              <b data-testid="wfRev">{gbp(r.revBase)}</b>
            </div>
            {r.carryTotal > 0 ? (
              <div className="wf pos" data-testid="wfCarryRow">
                <span>Plus carryover</span>
                <b data-testid="wfCarry">+ {gbp(r.carryTotal)}</b>
              </div>
            ) : null}
            <div className="wf neg">
              <span>Less staff cost</span>
              <b data-testid="wfStaff">− {gbp(r.staff)}</b>
            </div>
            <div className="wf">
              <span>= Operating margin</span>
              <b data-testid="wfMargin">{gbp(r.margin)}</b>
            </div>
            <div className="wf neg">
              <span>Less investments</span>
              <b data-testid="wfInv">− {gbp(r.invTotal)}</b>
            </div>
            <div className="wf">
              <span>= Distributable profit</span>
              <b data-testid="wfNet">{gbp(r.net)}</b>
            </div>
            <div className="wf neg">
              <span>Less debts repaid to owners</span>
              <b data-testid="wfDebtRepay">− {gbp(r.debtTotal)}</b>
            </div>
            {r.credA > 0 ? (
              <div className="wf neg" data-testid="wfOwnerARow">
                <span>Less {r.nameA} staff credit</span>
                <b data-testid="wfOwnerA">− {gbp(r.credA)}</b>
              </div>
            ) : null}
            {r.credB > 0 ? (
              <div className="wf neg" data-testid="wfOwnerBRow">
                <span>Less {r.nameB} staff credit</span>
                <b data-testid="wfOwnerB">− {gbp(r.credB)}</b>
              </div>
            ) : null}
            {r.fiftyTotal > 0 ? (
              <div className="wf neg" data-testid="wf50row">
                <span>Less 50/50 unclaimed-days pool</span>
                <b data-testid="wf50">− {gbp(r.fiftyTotal)}</b>
              </div>
            ) : null}
            <div className="wf total">
              <span>
                = Profit to split ({r.aPc} / {r.bPc})
              </span>
              <b data-testid="wfSplit">{gbp(r.splitPot)}</b>
            </div>
          </div>

          <p className="note">
            Owner debts, owner staff credits and any 50/50 unclaimed-days pool are set aside from
            the profit first; whatever&rsquo;s left is split by the shares below. Debts and staff
            credits go to that owner; the 50/50 pool is shared equally. Total distributed always
            equals distributable profit.
          </p>

          <div className="slider-wrap">
            <div className="bar">
              <div className="segA" style={{ width: `${r.aPc}%` }} />
              <div className="segB" style={{ width: `${r.bPc}%` }} />
            </div>
            <input
              type="range"
              min="0"
              max="100"
              data-testid="splitRange"
              aria-label="Owner A share of the profit split"
              value={state.split}
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </div>

          <div className="owners">
            <div className="owner a">
              <input
                type="text"
                data-testid="nameA"
                aria-label="Owner A name"
                value={state.nameA}
                onChange={(e) => patch({ nameA: e.target.value })}
              />
              <div className="amt" data-testid="amtA">
                {gbp(r.totalA)}
              </div>
              <div className="pc" data-testid="brkA">
                {breakdown(r.aPc, r.shareA, r.debtATotal, r.half, r.credA)}
              </div>
            </div>
            <div className="owner b">
              <input
                type="text"
                data-testid="nameB"
                aria-label="Owner B name"
                value={state.nameB}
                onChange={(e) => patch({ nameB: e.target.value })}
              />
              <div className="amt" data-testid="amtB">
                {gbp(r.totalB)}
              </div>
              <div className="pc" data-testid="brkB">
                {breakdown(r.bPc, r.shareB, r.debtBTotal, r.half, r.credB)}
              </div>
            </div>
          </div>

          <div className="sub">
            <span>Total distributed to owners</span>
            <b data-testid="totalDist">{gbp(r.totalDist)}</b>
          </div>

          <div className="split-inputs">
            <div>
              <label htmlFor="pcInA">{r.nameA} share %</label>
              <div className="prefix">
                <span>%</span>
                <input
                  type="number"
                  id="pcInA"
                  data-testid="pcInA"
                  min="0"
                  max="100"
                  step="1"
                  value={r.aPc}
                  onChange={(e) => setSplit(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="pcInB">{r.nameB} share %</label>
              <div className="prefix">
                <span>%</span>
                <input
                  type="number"
                  id="pcInB"
                  data-testid="pcInB"
                  min="0"
                  max="100"
                  step="1"
                  value={r.bPc}
                  onChange={(e) => setSplit(100 - (Number(e.target.value) || 0))}
                />
              </div>
            </div>
          </div>
          <p className="note">Shares always total 100% — adjusting one updates the other.</p>
        </section>
      </div>

      <p className="foot">
        All figures in GBP. Values update live and are saved automatically in this browser. Use
        “Reset to presets” to restore the starting figures.
      </p>
    </div>
  );
}

function breakdown(pc: number, share: number, debt: number, half: number, staffCredit: number) {
  return (
    `${pc}% of split (${gbp(share)})` +
    (staffCredit > 0 ? ` + ${gbp(staffCredit)} staff` : "") +
    (debt > 0 ? ` + ${gbp(debt)} debt back` : "") +
    (half > 0 ? ` + ${gbp(half)} (50/50)` : "")
  );
}

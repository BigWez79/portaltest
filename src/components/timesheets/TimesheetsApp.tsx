"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { Customer } from "@/lib/invoices-calc";
import type { PdfSeller } from "@/lib/pdf";
import {
  downloadStatementPdf,
  downloadTimesheetInvoicePdf,
  downloadTimesheetPdf,
} from "./timesheet-pdf";
import {
  closeMonth,
  deleteDay,
  issueTimesheetInvoice,
  saveDayRate,
  deleteHours,
  submitDay,
  type TimesheetState,
} from "@/app/actions/timesheets";
import {
  ACTIVITY_TYPES,
  FULL_DAY_HOURS,
  dayName,
  daysWorked,
  groupByMonth,
  inPeriod,
  isFullDay,
  monthName,
  periodLabel,
  periodsFor,
  type Period,
  type TimesheetIssue,
  type TimesheetEntry,
} from "@/lib/timesheets-calc";

const idle: TimesheetState = { status: "idle" };

/** One row of the day form, before it becomes an entry. */
type Draft = { key: string; type: string; hours: string; project: string; desc: string };

let drafted = 0;
const blankActivity = (): Draft => ({
  // A stable key per row, so React keeps the inputs in place when one above is
  // removed. An index would move every row's state up by one.
  key: `draft-${++drafted}`,
  type: "Project work",
  hours: "",
  project: "",
  desc: "",
});

// 8 h, 6.5 h, 3.25 h — two places at most, and no trailing zero. "6.50 h"
// reads like a precision nobody logged.
const hrs = (n: number) => `${Number(n.toFixed(2))} h`;

/** Whole pounds with a separator — a figure to look at, not one to pay. */
const gbpish = (n: number) => "£" + Math.round(n).toLocaleString("en-GB");

export function TimesheetsApp({
  entries,
  locked,
  dayRate,
  person,
  seller,
  vatRate,
  customers,
  issued,
  canInvoice,
}: {
  entries: TimesheetEntry[];
  locked: string[];
  dayRate: number | null;
  person: { name: string | null; email: string };
  seller: PdfSeller;
  /** 20 when the profile says VAT registered, 0 when it does not. */
  vatRate: number;
  /** Empty unless this person can also reach Invoices. */
  customers: Customer[];
  issued: TimesheetIssue[];
  canInvoice: boolean;
}) {
  const [day, dayAction, saving] = useActionState(submitDay, idle);
  const [del, delAction] = useActionState(deleteHours, idle);
  const [wipeDay, wipeDayAction] = useActionState(deleteDay, idle);
  const [close, closeAction] = useActionState(closeMonth, idle);
  const [rate, rateAction, savingRate] = useActionState(saveDayRate, idle);
  const [issue, issueAction, issuing] = useActionState(issueTimesheetInvoice, idle);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activities, setActivities] = useState<Draft[]>(() => [blankActivity()]);
  const [editing, setEditing] = useState(false);
  const [period, setPeriod] = useState<Period>("month");

  function setActivity(at: number, patch: Partial<Draft>) {
    setActivities((list) => list.map((a, i) => (i === at ? { ...a, ...patch } : a)));
  }

  function newDay() {
    setEditing(false);
    setActivities([blankActivity()]);
  }

  /** Load a whole day back into the form — every activity on it, not one. */
  function editDay(d: { date: string; entries: TimesheetEntry[] }) {
    setDate(d.date);
    setEditing(true);
    setActivities(
      d.entries.map((e) => ({
        key: e.id,
        type: e.activityType,
        hours: String(e.hoursWorked),
        project: e.project ?? "",
        desc: e.workDescription ?? "",
      })),
    );
    // The form is above the list it was opened from.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // A save that worked leaves the form ready for the next day rather than
  // sitting in "Editing 14 July" with the day it just wrote still in it.
  useEffect(() => {
    if (day.status === "ok") {
      setEditing(false);
      setActivities([blankActivity()]);
    }
  }, [day.status, day.message]);

  const months = useMemo(() => groupByMonth(entries), [entries]);
  const isLocked = (m: string) => locked.includes(m);
  const alreadyIssued = (m: string) => issued.some((i) => i.claimMonth === m);

  const thisMonth = months[0];

  // The period the buttons are showing. Newest first, so "this month" and "this
  // financial year" are what somebody lands on.
  const periods = useMemo(() => periodsFor(entries, period), [entries, period]);
  const inCurrent = useMemo(
    () => (periods.length === 0 ? [] : entries.filter((e) => inPeriod(e.entryDate, period, periods[0]))),
    [entries, period, periods],
  );
  const periodHours = inCurrent.reduce((n, e) => n + e.hoursWorked, 0);
  const periodDays = daysWorked(inCurrent);
  const [docProblem, setDocProblem] = useState(false);

  const docFor = () => ({
    entries: inCurrent,
    period,
    periodKey: periods[0],
    person,
    seller,
  });

  const run = (make: () => Promise<void>) => {
    setDocProblem(false);
    make().catch(() => setDocProblem(true));
  };

  return (
    <div className="ts-app" data-testid="timesheets-app">
      <div className="ts-bar">
        <div className="seg" role="group" aria-label="Period">
          <button
            type="button"
            aria-pressed={period === "month"}
            onClick={() => setPeriod("month")}
            data-testid="period-month"
          >
            Month
          </button>
          <button
            type="button"
            aria-pressed={period === "year"}
            onClick={() => setPeriod("year")}
            data-testid="period-year"
          >
            Financial year
          </button>
        </div>

        <form action={rateAction} className="ts-rate" data-testid="day-rate-form">
          <label className="field app-field ts-ratefield">
            <span className="field-label">Day rate (£)</span>
            <input
              type="number"
              name="dayRate"
              step="0.01"
              min="0"
              placeholder="not set"
              defaultValue={dayRate ?? ""}
              data-testid="ts-day-rate"
            />
          </label>
          <button type="submit" className="quiet" disabled={savingRate} data-testid="save-day-rate">
            {savingRate ? "Saving…" : "Save day rate"}
          </button>
        </form>
      </div>

      {issue.status === "ok" ? (
        <div className="msg ok" role="status" data-testid="issue-ok">
          {issue.message}
        </div>
      ) : null}
      {issue.status === "error" ? (
        <div className="msg" role="alert" data-testid="issue-error">
          {issue.message}
        </div>
      ) : null}
      {rate.status === "ok" ? (
        <div className="msg ok" role="status" data-testid="rate-ok">
          {rate.message}
        </div>
      ) : null}
      {rate.status === "error" ? (
        <div className="msg" role="alert" data-testid="rate-error">
          {rate.message}
        </div>
      ) : null}

      {periods.length > 0 ? (
        <section className="ts-card ts-periodcard" data-testid="period-card">
          <div className="ts-month-head">
            <h2 className="ts-h" data-testid="period-name">
              {periodLabel(period, periods[0])}
            </h2>
            <div className="ts-month-total" data-testid="period-total">
              {hrs(periodHours)}
            </div>
          </div>
          <div className="ts-docs">
            <button
              type="button"
              className="ts-doc"
              onClick={() => run(() => downloadTimesheetPdf(docFor()))}
              data-testid="doc-timesheet"
            >
              Timesheet
            </button>

            {period === "month" ? (
              <button
                type="button"
                className="ts-doc"
                disabled={dayRate == null}
                onClick={() =>
                  run(() =>
                    downloadTimesheetInvoicePdf({
                      ...docFor(),
                      dayRate: dayRate ?? 0,
                      vatRate,
                      // Draft until the month is closed. Closing a month is how
                      // it gets billed, so anything before that is a figure that
                      // can still change — and a customer paying against it
                      // would be paying the wrong amount.
                      draft: !isLocked(periods[0]),
                    }),
                  )
                }
                data-testid="doc-invoice"
              >
                {isLocked(periods[0]) ? "Invoice" : "Invoice (draft)"}
              </button>
            ) : (
              <button
                type="button"
                className="ts-doc"
                onClick={() => run(() => downloadStatementPdf({ ...docFor(), dayRate }))}
                data-testid="doc-statement"
              >
                Statement
              </button>
            )}

            {dayRate == null && period === "month" ? (
              <span className="ts-quiet" data-testid="no-rate">
                Set a day rate to invoice this month.
              </span>
            ) : null}
          </div>

          {docProblem ? (
            <p className="ts-problem" role="status" data-testid="doc-problem">
              That document could not be produced. Reload the page and try again.
            </p>
          ) : null}

          <p className="ts-quiet" data-testid="period-days">
            {periodDays} billable {periodDays === 1 ? "day" : "days"}
            {dayRate != null ? ` · ${gbpish(periodDays * dayRate)} at £${dayRate} a day` : ""}
          </p>
        </section>
      ) : null}

      {thisMonth ? (
        <div className="ts-kpis">
          <div className="kpi accent" data-testid="kpi-hours">
            <div className="k">{monthName(thisMonth.month)} logged</div>
            <div className="v">{hrs(thisMonth.hours)}</div>
          </div>
          <div className="kpi good" data-testid="kpi-worked">
            <div className="k">Of that, worked</div>
            <div className="v">{hrs(thisMonth.billable)}</div>
          </div>
          <div className="kpi" data-testid="kpi-days">
            <div className="k">Days with hours on them</div>
            <div className="v">{thisMonth.days.length}</div>
          </div>
        </div>
      ) : null}

      <section className="ts-card">
        <h2 className="ts-h">
          {editing ? `Editing ${dayName(date)}` : "Log a day"}{" "}
          <span className="tag">a day goes in once</span>
        </h2>

        <form action={dayAction} className="ts-form" data-testid="day-form">
          <input type="hidden" name="editing" value={editing ? "yes" : "no"} />

          <div className="ts-grid">
            <label className="field app-field">
              <span className="field-label">Date</span>
              <input
                type="date"
                name="entryDate"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                readOnly={editing}
                data-testid="entry-date"
              />
            </label>
          </div>

          <ol className="ts-activities" data-testid="activities">
            {activities.map((a, i) => {
              const full = isFullDay(a.type);
              return (
                <li className="ts-activity" key={a.key} data-testid={`activity-${i}`}>
                  <div className="ts-grid">
                    <label className="field app-field">
                      <span className="field-label">Activity</span>
                      <select
                        name="activityType"
                        value={a.type}
                        onChange={(e) => setActivity(i, { type: e.target.value })}
                        data-testid={`entry-type-${i}`}
                      >
                        {ACTIVITY_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>

                    {full ? (
                      <div className="field">
                        <span className="field-label">Hours</span>
                        <p className="ts-fixed" data-testid={`entry-fixed-${i}`}>
                          {FULL_DAY_HOURS} h — a whole day
                        </p>
                        {/* Still posted, so the parallel arrays stay lined up.
                            Dropping the input for a full day would shift every
                            later row's hours onto the wrong activity. */}
                        <input type="hidden" name="hoursWorked" value={FULL_DAY_HOURS} />
                      </div>
                    ) : (
                      <label className="field app-field">
                        <span className="field-label">Hours</span>
                        <input
                          type="number"
                          name="hoursWorked"
                          step="0.25"
                          min="0.25"
                          max="24"
                          required
                          value={a.hours}
                          onChange={(e) => setActivity(i, { hours: e.target.value })}
                          data-testid={`entry-hours-${i}`}
                        />
                      </label>
                    )}

                    <label className="field app-field">
                      <span className="field-label">Project</span>
                      <input
                        type="text"
                        name="project"
                        value={a.project}
                        onChange={(e) => setActivity(i, { project: e.target.value })}
                        data-testid={`entry-project-${i}`}
                      />
                    </label>

                    <label className="field app-field ts-wide">
                      <span className="field-label">What you did</span>
                      <input
                        type="text"
                        name="workDescription"
                        value={a.desc}
                        onChange={(e) => setActivity(i, { desc: e.target.value })}
                        data-testid={`entry-desc-${i}`}
                      />
                    </label>

                    {activities.length > 1 ? (
                      <button
                        type="button"
                        className="quiet danger ts-drop"
                        onClick={() => setActivities(activities.filter((_, n) => n !== i))}
                        data-testid={`drop-activity-${i}`}
                      >
                        Remove<span className="sr-only"> activity {i + 1}</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="ts-formactions">
            <button
              type="button"
              className="btn-add"
              onClick={() => setActivities([...activities, blankActivity()])}
              data-testid="add-activity"
            >
              + Add activity
            </button>

            <button type="submit" className="primary" disabled={saving} data-testid="submit-day">
              {saving ? "Saving…" : editing ? "Save day" : "Submit day"}
            </button>

            {editing ? (
              <button type="button" className="quiet" onClick={newDay} data-testid="cancel-edit">
                Cancel edit
              </button>
            ) : null}

            <span className="ts-quiet" data-testid="day-total">
              {hrs(activities.reduce((n, a) => n + (isFullDay(a.type) ? FULL_DAY_HOURS : Number(a.hours) || 0), 0))} on this day
            </span>
          </div>

          {day.status === "error" ? (
            <div className="msg" role="alert" data-testid="log-error">
              {day.message}
            </div>
          ) : null}
          {day.status === "ok" ? (
            <div className="msg ok" role="status" data-testid="log-ok">
              {day.message}
            </div>
          ) : null}
        </form>
      </section>

      {wipeDay.status === "error" ? (
        <div className="msg" role="alert" data-testid="day-del-error">
          {wipeDay.message}
        </div>
      ) : null}
      {del.status === "error" ? (
        <div className="msg" role="alert" data-testid="del-error">
          {del.message}
        </div>
      ) : null}
      {close.status === "ok" ? (
        <div className="msg ok" role="status" data-testid="close-ok">
          {close.message}
        </div>
      ) : null}
      {close.status === "error" ? (
        <div className="msg" role="alert" data-testid="close-error">
          {close.message}
        </div>
      ) : null}

      {months.length === 0 ? (
        <p className="ts-empty" data-testid="timesheets-empty">
          Nothing logged yet. Your first hours go in above.
        </p>
      ) : null}

      {months.map((m) => {
        const shut = isLocked(m.month);
        return (
          <section className="ts-card" key={m.month} data-testid={`month-${m.month}`}>
            <div className="ts-month-head">
              <h2 className="ts-h">
                {monthName(m.month)}
                {shut ? (
                  <span className="ts-lock" data-testid={`closed-${m.month}`}>
                    Closed
                  </span>
                ) : null}
              </h2>
              <div className="ts-month-total" data-testid={`total-${m.month}`}>
                {hrs(m.hours)}
              </div>
            </div>

            {m.days.map((d) => (
              <div className="ts-day" key={d.date} data-testid={`day-${d.date}`}>
                <div className="ts-day-head">
                  <span className="ts-day-name">{dayName(d.date)}</span>
                  <span className="ts-day-hours" data-testid={`day-total-${d.date}`}>
                    {hrs(d.hours)}
                  </span>
                  {shut ? null : (
                    <span className="ts-day-actions">
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => editDay(d)}
                        data-testid={`edit-day-${d.date}`}
                      >
                        Edit day
                      </button>
                      <form action={wipeDayAction} className="ts-inline">
                        <input type="hidden" name="entryDate" value={d.date} />
                        <button
                          type="submit"
                          className="quiet danger"
                          data-testid={`delete-day-${d.date}`}
                        >
                          Delete day
                        </button>
                      </form>
                    </span>
                  )}
                </div>

                <div className="ts-scroll">
                  <table className="ts-table">
                    <caption className="sr-only">Hours logged on {dayName(d.date)}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Activity</th>
                        <th scope="col">Project</th>
                        <th scope="col">What you did</th>
                        <th scope="col" className="ts-num">Hours</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.entries.map((e) => (
                        <tr key={e.id} data-testid={`entry-${e.id}`}>
                          <td>
                            {e.activityType}
                            {isFullDay(e.activityType) ? (
                              <span className="tag ts-away">away</span>
                            ) : null}
                          </td>
                          <td>{e.project ?? "—"}</td>
                          <td>{e.workDescription ?? "—"}</td>
                          <td className="ts-num">{hrs(e.hoursWorked)}</td>
                          <td className="ts-row-actions">
                            {shut ? null : (
                              <form action={delAction} className="ts-inline">
                                <input type="hidden" name="id" value={e.id} />
                                <button type="submit" className="quiet danger" data-testid={`remove-${e.id}`}>
                                  Remove
                                  <span className="sr-only">
                                    {" "}
                                    {e.activityType} on {e.entryDate}
                                  </span>
                                </button>
                              </form>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {shut && canInvoice ? (
              alreadyIssued(m.month) ? (
                <p className="ts-quiet" data-testid={`issued-${m.month}`}>
                  Invoiced. A month is billed once — raise a second invoice from
                  Invoices if something needs adding.
                </p>
              ) : (
                <form action={issueAction} className="ts-issue" data-testid={`issue-form-${m.month}`}>
                  <input type="hidden" name="month" value={m.month} />
                  <label className="field app-field ts-customer">
                    <span className="field-label">Invoice to</span>
                    <select name="customerId" required data-testid={`issue-customer-${m.month}`}>
                      <option value="">Choose…</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.companyName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="btn-good"
                    disabled={issuing || dayRate == null}
                    data-testid={`issue-${m.month}`}
                  >
                    {issuing ? "Raising…" : "Issue invoice"}
                  </button>
                  {dayRate == null ? (
                    <span className="ts-quiet">Set a day rate first.</span>
                  ) : (
                    <span className="ts-quiet">
                      {daysWorked(m.days.flatMap((d) => d.entries))} days at £{dayRate}
                    </span>
                  )}
                </form>
              )
            ) : null}

            {shut ? null : (
              <form action={closeAction} className="ts-close">
                <input type="hidden" name="month" value={m.month} />
                <button type="submit" className="primary" data-testid={`close-${m.month}`}>
                  Close {monthName(m.month)}
                </button>
                <span className="ts-quiet">
                  Closing a month is how it gets billed. Nothing in it can change afterwards.
                </span>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}

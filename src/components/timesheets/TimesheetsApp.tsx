"use client";

import { useActionState, useMemo, useState } from "react";
import {
  closeMonth,
  deleteHours,
  logHours,
  type TimesheetState,
} from "@/app/actions/timesheets";
import {
  ACTIVITY_TYPES,
  FULL_DAY_HOURS,
  dayName,
  groupByMonth,
  isFullDay,
  monthName,
  type TimesheetEntry,
} from "@/lib/timesheets-calc";

const idle: TimesheetState = { status: "idle" };

// 8 h, 6.5 h, 3.25 h — two places at most, and no trailing zero. "6.50 h"
// reads like a precision nobody logged.
const hrs = (n: number) => `${Number(n.toFixed(2))} h`;

export function TimesheetsApp({
  entries,
  locked,
}: {
  entries: TimesheetEntry[];
  locked: string[];
}) {
  const [log, logAction, logging] = useActionState(logHours, idle);
  const [del, delAction] = useActionState(deleteHours, idle);
  const [close, closeAction] = useActionState(closeMonth, idle);

  const [type, setType] = useState<string>("Project work");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const months = useMemo(() => groupByMonth(entries), [entries]);
  const isLocked = (m: string) => locked.includes(m);
  const fullDay = isFullDay(type);

  const thisMonth = months[0];

  return (
    <div className="ts-app" data-testid="timesheets-app">
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
          Log some hours <span className="tag">a day can hold several</span>
        </h2>

        <form action={logAction} className="ts-form" data-testid="log-form">
          <div className="ts-grid">
            <label className="field app-field">
              <span className="field-label">Date</span>
              <input
                type="date"
                name="entryDate"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="entry-date"
              />
            </label>

            <label className="field app-field">
              <span className="field-label">Activity</span>
              <select
                name="activityType"
                value={type}
                onChange={(e) => setType(e.target.value)}
                data-testid="entry-type"
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            {fullDay ? (
              <div className="field">
                <span className="field-label">Hours</span>
                <p className="ts-fixed" data-testid="entry-fixed">
                  {FULL_DAY_HOURS} h — a whole day
                </p>
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
                  data-testid="entry-hours"
                />
              </label>
            )}

            <label className="field app-field">
              <span className="field-label">Project</span>
              <input type="text" name="project" data-testid="entry-project" />
            </label>

            <label className="field app-field ts-wide">
              <span className="field-label">What you did</span>
              <input type="text" name="workDescription" data-testid="entry-desc" />
            </label>
          </div>

          {log.status === "error" ? (
            <div className="msg" role="alert" data-testid="log-error">
              {log.message}
            </div>
          ) : null}
          {log.status === "ok" ? (
            <div className="msg ok" role="status" data-testid="log-ok">
              {log.message}
            </div>
          ) : null}

          <div>
            <button type="submit" className="primary" disabled={logging} data-testid="log-submit">
              {logging ? "Logging…" : "Log it"}
            </button>
          </div>
        </form>
      </section>

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

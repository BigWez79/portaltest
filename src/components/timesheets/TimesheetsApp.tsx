"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  closeMonth,
  deleteDay,
  deleteHours,
  submitDay,
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

export function TimesheetsApp({
  entries,
  locked,
}: {
  entries: TimesheetEntry[];
  locked: string[];
}) {
  const [day, dayAction, saving] = useActionState(submitDay, idle);
  const [del, delAction] = useActionState(deleteHours, idle);
  const [wipeDay, wipeDayAction] = useActionState(deleteDay, idle);
  const [close, closeAction] = useActionState(closeMonth, idle);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activities, setActivities] = useState<Draft[]>(() => [blankActivity()]);
  const [editing, setEditing] = useState(false);

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

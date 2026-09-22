"use client";

import { useMemo, useState } from "react";
import {
  billableHours,
  isFullDay,
  monthName,
  round2,
  type TimesheetEntry,
} from "@/lib/timesheets-calc";

const hrs = (n: number) => `${Number(n.toFixed(2))} h`;

/**
 * Monthly Overview — the month, summarised.
 *
 * The live page reads the timesheet list and adds an "Administrators only"
 * section. Here that section is not a separate query: an admin's read returns
 * everybody's rows because the policy says so, so the page simply notices it is
 * looking at more than one person and groups accordingly.
 */
export function OverviewApp({
  entries,
  months,
  isAdmin,
  email,
}: {
  entries: TimesheetEntry[];
  months: string[];
  isAdmin: boolean;
  email: string;
}) {
  const [month, setMonth] = useState(months[0] ?? "");

  const inMonth = useMemo(
    () => entries.filter((e) => e.claimMonth === month),
    [entries, month],
  );

  const mine = useMemo(() => inMonth.filter((e) => e.staffEmail === email), [inMonth, email]);

  const totals = useMemo(() => {
    const all = round2(mine.reduce((s, e) => s + e.hoursWorked, 0));
    return {
      logged: all,
      worked: billableHours(mine),
      away: round2(all - billableHours(mine)),
      days: new Set(mine.map((e) => e.entryDate)).size,
    };
  }, [mine]);

  const byActivity = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of mine) m.set(e.activityType, round2((m.get(e.activityType) ?? 0) + e.hoursWorked));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [mine]);

  const byProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of mine) {
      if (isFullDay(e.activityType)) continue;
      const key = e.project?.trim() || "No project";
      m.set(key, round2((m.get(key) ?? 0) + e.hoursWorked));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [mine]);

  const byPerson = useMemo(() => {
    if (!isAdmin) return [];
    const m = new Map<string, { name: string; hours: number; worked: number }>();
    for (const e of inMonth) {
      const got = m.get(e.staffEmail) ?? { name: e.staffName ?? e.staffEmail, hours: 0, worked: 0 };
      got.hours = round2(got.hours + e.hoursWorked);
      if (!isFullDay(e.activityType)) got.worked = round2(got.worked + e.hoursWorked);
      m.set(e.staffEmail, got);
    }
    return [...m.entries()].sort((a, b) => b[1].hours - a[1].hours);
  }, [inMonth, isAdmin]);

  const widest = Math.max(1, ...byActivity.map(([, h]) => h));

  return (
    <div className="ov-app" data-testid="overview-app">
      {months.length === 0 ? (
        <p className="ov-empty" data-testid="overview-empty">
          Nothing logged yet. Once there are hours on a timesheet, the month appears here.
        </p>
      ) : (
        <>
          <label className="field app-field ov-picker">
            <span className="field-label">Month</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)} data-testid="month-picker">
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </label>

          <div className="ov-kpis">
            <div className="kpi accent" data-testid="ov-logged">
              <div className="k">Logged</div>
              <div className="v">{hrs(totals.logged)}</div>
            </div>
            <div className="kpi good" data-testid="ov-worked">
              <div className="k">Worked</div>
              <div className="v">{hrs(totals.worked)}</div>
            </div>
            <div className="kpi" data-testid="ov-away">
              <div className="k">Leave and sickness</div>
              <div className="v">{hrs(totals.away)}</div>
            </div>
            <div className="kpi" data-testid="ov-days">
              <div className="k">Days worked on</div>
              <div className="v">{totals.days}</div>
            </div>
          </div>

          <section className="ov-card">
            <h2 className="ov-h">
              Where the time went <span className="tag">your hours</span>
            </h2>

            {byActivity.length === 0 ? (
              <p className="ov-quiet" data-testid="ov-noactivity">
                Nothing logged in {monthName(month)}.
              </p>
            ) : (
              <ul className="ov-bars">
                {byActivity.map(([type, h]) => (
                  <li key={type} data-testid={`activity-${type.replace(/\W+/g, "-").toLowerCase()}`}>
                    <span className="ov-bar-label">{type}</span>
                    <span className="ov-bar-track">
                      {/* Width against the largest row, so the shortest bar is
                          still visible rather than a sliver of a percent. */}
                      <span className="ov-bar-fill" style={{ width: `${(h / widest) * 100}%` }} />
                    </span>
                    <span className="ov-bar-value">{hrs(h)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ov-card">
            <h2 className="ov-h">
              By project <span className="tag">leave left out</span>
            </h2>
            <div className="ov-scroll">
              <table className="ov-table">
                <caption className="sr-only">Hours by project in {monthName(month)}</caption>
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col" className="ov-num">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {byProject.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="ov-quiet">No work logged against a project.</td>
                    </tr>
                  ) : null}
                  {byProject.map(([project, h]) => (
                    <tr key={project} data-testid={`project-${project.replace(/\W+/g, "-").toLowerCase()}`}>
                      <td>{project}</td>
                      <td className="ov-num">{hrs(h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {isAdmin ? (
            <section className="ov-card" data-testid="everybody">
              <h2 className="ov-h">
                Everybody <span className="tag">admins only</span>
              </h2>
              <p className="ov-quiet">
                The only screen in the suite that shows another person&rsquo;s figures. It is the
                same query as above — the policy returns everybody&rsquo;s rows to an admin.
              </p>
              <div className="ov-scroll">
                <table className="ov-table">
                  <caption className="sr-only">Everybody&rsquo;s hours in {monthName(month)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col" className="ov-num">Logged</th>
                      <th scope="col" className="ov-num">Worked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPerson.map(([who, row]) => (
                      <tr key={who} data-testid={`person-${who}`}>
                        <td>{row.name}</td>
                        <td className="ov-num">{hrs(row.hours)}</td>
                        <td className="ov-num">{hrs(row.worked)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

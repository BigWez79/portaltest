"use client";

import {
  ACTIVITY_COLOURS,
  buildTeamGrid,
  colourFor,
  isFullDay,
  type TimesheetEntry,
} from "@/lib/timesheets-calc";

/**
 * Everybody's month, as the live Monthly Overview draws it.
 *
 * This is what the page is for, and the port had replaced it with a personal
 * hours summary — a different screen, not a thinner one. An admin opens this to
 * see who was in and who was away, across the whole team, at a glance. A table
 * of totals cannot answer that: the answer is a shape.
 *
 * Administrators only, which is the live page's own rule. The personal summary
 * above it stays for everybody.
 */

const hrs = (n: number) => `${Number(n.toFixed(2))} h`;

const dayNumber = (iso: string) => Number(iso.slice(8, 10));

const weekdayLetter = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "narrow" });

export function TeamGrid({ entries, month }: { entries: TimesheetEntry[]; month: string }) {
  const grid = buildTeamGrid(entries, month);

  if (grid.people.length === 0) {
    return (
      <p className="ov-quiet" data-testid="grid-empty">
        Nobody logged anything this month.
      </p>
    );
  }

  return (
    <div className="ov-grid-wrap" data-testid="team-grid">
      <ul className="ov-legend" data-testid="legend">
        {Object.keys(ACTIVITY_COLOURS).map((activity) => (
          <li key={activity} className={isFullDay(activity) ? "is-away" : undefined}>
            <span className="ov-sw" style={{ background: colourFor(activity) }} aria-hidden="true" />
            {activity}
          </li>
        ))}
      </ul>

      <div className="ov-gridscroll">
        <table className="ov-grid">
          <caption className="sr-only">
            Everybody&rsquo;s hours by working day. Each bar is one day, split by activity.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="ov-who">
                Person
              </th>
              {grid.days.map((d) => (
                <th key={d} scope="col" className="ov-dayhead">
                  <span className="ov-dow">{weekdayLetter(d)}</span>
                  <span className="ov-dnum">{dayNumber(d)}</span>
                </th>
              ))}
              <th scope="col" className="ov-num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.people.map((person) => (
              <tr key={person.email} data-testid={`grid-${person.email}`}>
                <th scope="row" className="ov-who">
                  {person.name}
                </th>

                {grid.days.map((date) => {
                  const day = person.days[date];
                  const total = day ? Object.values(day).reduce((a, b) => a + b, 0) : 0;
                  // Every bar is measured against the busiest single day anybody
                  // had, so two people's columns can be compared by eye. Scaling
                  // each person to their own maximum would make a four-hour day
                  // look like a full one.
                  const height = total === 0 ? 0 : (total / grid.maxDaily) * 100;

                  return (
                    <td key={date} className="ov-cell">
                      {total > 0 ? (
                        <span
                          className="ov-bar"
                          style={{ height: `${height}%` }}
                          title={`${person.name}, ${date}: ${hrs(total)}`}
                          data-testid={`cell-${person.email}-${date}`}
                        >
                          {Object.entries(day!).map(([activity, hours]) => (
                            <span
                              key={activity}
                              className="ov-seg"
                              style={{
                                background: colourFor(activity),
                                flexGrow: hours,
                              }}
                              data-activity={activity}
                            />
                          ))}
                          <span className="sr-only">
                            {person.name}, {date}:{" "}
                            {Object.entries(day!)
                              .map(([a, h]) => `${a} ${hrs(h)}`)
                              .join(", ")}
                          </span>
                        </span>
                      ) : null}
                    </td>
                  );
                })}

                <td className="ov-num" data-testid={`grid-total-${person.email}`}>
                  {hrs(person.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ov-activity-totals" data-testid="activity-totals">
        {grid.activityTotals.map(([activity, hours]) => (
          <span key={activity} className="ov-at" data-testid={`at-${activity.replace(/\W+/g, "-").toLowerCase()}`}>
            <span className="ov-sw" style={{ background: colourFor(activity) }} aria-hidden="true" />
            {activity}
            <b>{hrs(hours)}</b>
          </span>
        ))}
        <span className="ov-at is-grand" data-testid="grand-total">
          Everybody
          <b>{hrs(grid.grand)}</b>
        </span>
      </div>
    </div>
  );
}

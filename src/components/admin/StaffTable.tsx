"use client";

import { useActionState } from "react";
import { toggleFlag, type AdminState } from "@/app/actions/staff";
import type { StaffRow } from "@/lib/staff";
import type { Flag } from "@/lib/staff-admin";

const initial: AdminState = { status: "idle" };

const PERMISSIONS: Array<{ flag: Flag; label: string; short: string }> = [
  { flag: "hasInvoices", label: "Invoices", short: "Inv" },
  { flag: "hasTimesheet", label: "Timesheets", short: "Time" },
  { flag: "hasExpenses", label: "Expenses", short: "Exp" },
  { flag: "isAdmin", label: "Admin", short: "Admin" },
];

function Toggle({
  row,
  flag,
  label,
  disabled,
}: {
  row: StaffRow;
  flag: Flag;
  label: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(toggleFlag, initial);
  const on = row[flag] === true;

  return (
    <form action={action} className="toggle-form">
      <input type="hidden" name="email" value={row.email} />
      <input type="hidden" name="flag" value={flag} />
      <input type="hidden" name="value" value={String(!on)} />
      <button
        type="submit"
        className={`toggle ${on ? "on" : "off"}`}
        disabled={disabled || pending}
        aria-pressed={on}
        title={
          disabled
            ? "You cannot change this for yourself"
            : `${on ? "Remove" : "Grant"} ${label} for ${row.email}`
        }
        data-testid={`toggle-${row.email}-${flag}`}
      >
        <span className="sr-only">
          {label} for {row.email}
        </span>
        <span aria-hidden="true">{on ? "on" : "off"}</span>
      </button>
      {state.status === "error" ? (
        <span className="toggle-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function StaffTable({
  staff,
  currentEmail,
}: {
  staff: StaffRow[];
  currentEmail: string;
}) {
  if (staff.length === 0) {
    return <p className="empty">Nobody on the staff list yet.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="staff-table" data-testid="staff-table">
        <thead>
          <tr>
            <th scope="col">Person</th>
            {PERMISSIONS.map((p) => (
              <th scope="col" key={p.flag} className="col-toggle">
                <span className="th-long">{p.label}</span>
                <span className="th-short">{p.short}</span>
              </th>
            ))}
            <th scope="col" className="col-toggle">
              Active
            </th>
          </tr>
        </thead>
        <tbody>
          {staff.map((row) => {
            const isSelf = row.email === currentEmail;
            return (
              <tr key={row.email} className={row.active ? "" : "inactive"} data-testid={`row-${row.email}`}>
                <th scope="row">
                  <span className="person-name">
                    {row.fullName ?? row.email}
                    {isSelf ? <span className="you">you</span> : null}
                  </span>
                  <span className="person-email">{row.email}</span>
                  {!row.lastSeenAt && row.invitedAt ? (
                    <span className="pending">invited, not signed in</span>
                  ) : null}
                </th>
                {PERMISSIONS.map((p) => (
                  <td key={p.flag} className="col-toggle">
                    <Toggle
                      row={row}
                      flag={p.flag}
                      label={p.label}
                      disabled={isSelf && p.flag === "isAdmin"}
                    />
                  </td>
                ))}
                <td className="col-toggle">
                  <Toggle row={row} flag="active" label="Active" disabled={isSelf} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

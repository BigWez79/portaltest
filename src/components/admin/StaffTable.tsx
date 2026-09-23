"use client";

import { useActionState } from "react";
import { removePerson, resendInvitation, toggleFlag, type AdminState } from "@/app/actions/staff";
import type { StaffRow } from "@/lib/staff";
import type { Flag } from "@/lib/staff-admin";

const initial: AdminState = { status: "idle" };

const PERMISSIONS: Array<{ flag: Flag; label: string; short: string }> = [
  { flag: "hasInvoices", label: "Invoices", short: "Inv" },
  { flag: "hasTimesheet", label: "Timesheets", short: "Time" },
  { flag: "hasExpenses", label: "Expenses", short: "Exp" },
  { flag: "hasMargin", label: "Margin", short: "Marg" },
  { flag: "hasTaxBreakdown", label: "Tax", short: "Tax" },
  { flag: "hasOverview", label: "Overview", short: "Over" },
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
  const person = row.fullName ?? row.email;

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
        {/*
          The whole accessible name of the button. It names the person the way
          the row header does, so what is heard matches what is read, and it
          says why a disabled one cannot be pressed — `title` does not carry
          that, because a disabled button is not focusable and not hovered by
          anyone using a keyboard.
        */}
        <span className="sr-only">
          {label} for {person}
          {disabled ? " — cannot be changed for yourself" : ""}
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
  const [resend, resendAction] = useActionState(resendInvitation, initial);
  const [removed, removeAction] = useActionState(removePerson, initial);

  if (staff.length === 0) {
    return <p className="empty">Nobody on the staff list yet.</p>;
  }

  return (
    <>
      {resend.status !== "idle" ? (
        <div
          className={`msg ${resend.status === "ok" ? "ok" : ""}`}
          role={resend.status === "ok" ? "status" : "alert"}
          data-testid="resend-msg"
        >
          {resend.message}
        </div>
      ) : null}
      {removed.status !== "idle" ? (
        <div
          className={`msg ${removed.status === "ok" ? "ok" : ""}`}
          role={removed.status === "ok" ? "status" : "alert"}
          data-testid="remove-msg"
        >
          {removed.message}
        </div>
      ) : null}

    <div className="table-scroll">
      <table className="staff-table" data-testid="staff-table">
        <thead>
          <tr>
            <th scope="col">Person</th>
            {PERMISSIONS.map((p) => (
              <th scope="col" key={p.flag} className="col-toggle">
                <span className="th-long">{p.label}</span>
                <span className="th-short" aria-hidden="true">
                  {p.short}
                </span>
              </th>
            ))}
            <th scope="col" className="col-toggle">
              Active
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
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
                <td className="row-actions">
                  {/* Resend is offered only where it helps: somebody invited who
                      has never signed in. Beside a person who signs in every day
                      it is a button that does nothing they need. */}
                  {!row.lastSeenAt && row.active ? (
                    <form action={resendAction} className="inline-form">
                      <input type="hidden" name="email" value={row.email} />
                      <button type="submit" className="quiet" data-testid={`resend-${row.email}`}>
                        Resend
                        <span className="sr-only"> the invitation to {row.email}</span>
                      </button>
                    </form>
                  ) : null}

                  {isSelf ? null : (
                    <form action={removeAction} className="inline-form">
                      <input type="hidden" name="email" value={row.email} />
                      <button
                        type="submit"
                        className="quiet danger"
                        data-testid={`remove-${row.email}`}
                      >
                        Remove
                        <span className="sr-only"> {row.email} from the staff list</span>
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

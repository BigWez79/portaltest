"use client";

import { useActionState } from "react";
import { invite, type AdminState } from "@/app/actions/staff";

const initial: AdminState = { status: "idle" };

export function InviteForm() {
  const [state, action, pending] = useActionState(invite, initial);

  return (
    <form action={action} className="invite-form" data-testid="invite-form">
      <div className="invite-fields">
        <label className="field">
          <span className="field-label">Full name</span>
          <input type="text" name="fullName" placeholder="Jane Smith" data-testid="invite-name" />
        </label>
        <label className="field">
          <span className="field-label">Work email</span>
          <input
            type="email"
            name="email"
            required
            placeholder="jane@poweranalytix.co.uk"
            data-testid="invite-email"
          />
        </label>
      </div>

      {state.status === "error" ? (
        <div className="msg" role="alert" data-testid="invite-error">
          {state.message}
        </div>
      ) : null}
      {state.status === "ok" ? (
        <div className="msg ok" role="status" data-testid="invite-ok">
          {state.message ?? "Invitation sent."}
        </div>
      ) : null}

      <button className="btn-primary" type="submit" disabled={pending} data-testid="invite-submit">
        {pending ? "Sending…" : "Send invitation"}
      </button>
    </form>
  );
}

"use client";

import Image from "next/image";
import { useActionState } from "react";
import { requestMagicLink, type SignInState } from "@/app/actions/auth";

const initial: SignInState = { status: "idle" };

/**
 * `signedOut` is set when somebody arrives here from /auth/signed-out — their
 * staff row was deactivated while they were signed in. It says so plainly
 * rather than dropping them on a bare sign-in form with no explanation.
 *
 * It tells nobody anything: only a person who held a session gets sent here,
 * and the message is the same whatever address that session belonged to.
 */
export function SignInCard({ error, signedOut }: { error?: string; signedOut?: boolean }) {
  const [state, formAction, pending] = useActionState(requestMagicLink, initial);

  return (
    <div className="wrap">
      <div className="card">
        <div className="login-view" data-testid="login-view">
          <div className="login-lockup">
            <Image src="/logo.png" alt="" width={52} height={52} priority />
            <div className="wordmark">
              <span className="power">Power</span>
              <span className="analytix">Analytix</span>
            </div>
          </div>
          <div className="login-title">Suite Portal</div>

          {signedOut ? (
            <div className="msg warn" role="status" data-testid="signed-out-notice">
              You have been signed out. If you should still have access, contact your
              administrator.
            </div>
          ) : null}

          {error === "link" ? (
            <div className="msg" role="alert" data-testid="signin-error">
              That link has expired or has already been used. Ask for a new one.
            </div>
          ) : null}

          {state.status === "sent" ? (
            <div className="msg ok" role="status" data-testid="link-sent">
              <b>Check your email.</b> If that address is on the staff list, a sign-in
              link is on its way. It is good for one hour.
            </div>
          ) : (
            <>
              <p>Sign in once to access all Power Analytix apps.</p>
              <form action={formAction} className="signin-form">
                <label className="field">
                  <span className="field-label">Work email</span>
                  <input
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                    autoFocus
                    placeholder="you@poweranalytix.co.uk"
                    data-testid="email"
                  />
                </label>

                {state.status === "error" ? (
                  <div className="msg" role="alert" data-testid="signin-error">
                    {state.message}
                  </div>
                ) : null}

                <button
                  className="btn-primary"
                  type="submit"
                  disabled={pending}
                  data-testid="signin"
                >
                  {pending ? "Sending…" : "Email me a sign-in link"}
                </button>
              </form>
              <p className="fineprint">
                No password to remember. The link signs you in on this device.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

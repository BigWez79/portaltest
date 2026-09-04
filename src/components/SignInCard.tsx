"use client";

import Image from "next/image";
import { useActionState } from "react";
import { requestMagicLink, type SignInState } from "@/app/actions/auth";
import { SIGNED_OUT_REASON } from "@/lib/signed-out";

const initial: SignInState = { status: "idle" };

export function SignInCard({ error }: { error?: string }) {
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

          {error === "link" ? (
            <div className="msg" role="alert" data-testid="signin-error">
              That link has expired or has already been used. Ask for a new one.
            </div>
          ) : null}

          {error === SIGNED_OUT_REASON ? (
            <div className="msg" role="alert" data-testid="access-ended">
              You have been signed out. Your access has ended — speak to your
              administrator if that is unexpected.
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

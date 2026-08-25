import Image from "next/image";
import { signIn } from "@/auth";
import { isTestMode } from "@/lib/env";

export function SignInCard({ error }: { error?: string }) {
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
          {error ? (
            <div className="msg" role="alert" data-testid="signin-error">
              {error === "AccessDenied"
                ? "That account is not part of the Power Analytix directory."
                : "Sign-in did not complete. Try again."}
            </div>
          ) : null}
          <p>Sign in once to access all Power Analytix apps.</p>
          <form
            action={async () => {
              "use server";
              if (isTestMode()) return;
              await signIn("microsoft-entra-id", { redirectTo: "/" });
            }}
          >
            <button className="btn-primary" type="submit" data-testid="signin">
              Sign in with Microsoft
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

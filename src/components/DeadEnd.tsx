import Image from "next/image";

/**
 * The two dead ends: a page that is not there, and a page that broke.
 *
 * Both wear the sign-in card's lockup, because both are seen by somebody who
 * may not be signed in — and the one thing they must not do is describe what
 * happened. Rule 4 says a route somebody has no flag for answers 404, and the
 * point of a 404 rather than a 403 is that it says nothing. A styled page that
 * then names the path, the flag or the framework gives back exactly what the
 * status code withheld, so the copy here carries no path, no flag, no stack and
 * no "you may not open this". tests/dead-ends.spec.ts pins that.
 *
 * The way back is a plain <a> and not next/link: after a crash the router is
 * the thing that may be broken, and a full navigation asks the server again
 * from nothing.
 */
export function DeadEnd({
  testId,
  title,
  note,
}: {
  testId: string;
  title: string;
  note: string;
}) {
  return (
    <main className="shell gated">
      <div className="wrap">
        <div className="card">
          <div className="login-view dead-end" data-testid={testId}>
            <div className="login-lockup">
              <Image src="/logo.png" alt="" width={52} height={52} priority />
              <div className="wordmark">
                <span className="power">Power</span>
                <span className="analytix">Analytix</span>
              </div>
            </div>
            <div className="login-title">{title}</div>
            <p>{note}</p>
            <a className="btn-primary" href="/">
              Back to Power Suite
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

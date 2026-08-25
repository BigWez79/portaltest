/**
 * Placeholder for an app that has not been folded in yet.
 *
 * It is deliberately a real, access-guarded route rather than a link out: the
 * gate, the shell and the switcher are proved before any of the app's own code
 * arrives, so porting it is a matter of replacing this component and nothing
 * else. Delete this file when the last app lands.
 */
export function PortedAppNotice({ app, blurb }: { app: string; blurb: string }) {
  return (
    <section className="card" data-testid="not-ported">
      <h2 className="card-title">{app} is not here yet</h2>
      <p className="card-note">
        You have access to {app} — {blurb} — but it still runs as its own app. It
        is being moved into the portal so there is one sign-in, one deploy and one
        place to look.
      </p>
      <p className="card-note">
        Nothing you do elsewhere is affected in the meantime.
      </p>
    </section>
  );
}

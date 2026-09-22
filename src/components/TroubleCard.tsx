import Image from "next/image";
import Link from "next/link";

/**
 * The card shown when Power Suite cannot show somebody the page they asked for
 * — a 404, or a crash. One component, because the two screens must be
 * indistinguishable from the outside: if the "went wrong" card looked different
 * from the "not here" card, the pair of them would tell an unauthenticated
 * visitor which of the two had happened.
 *
 * It says nothing about what was asked for. No path, no flag name, no digest,
 * no "you do not have access to this" — rule 4 exists so that somebody trying
 * /invoices to see what happens learns nothing, and a helpful message here
 * would hand back exactly what the 404 was hiding.
 *
 * Built from the sign-in card's own classes rather than new ones: restyling is
 * a person's job (BLOCKED.md), so this borrows a look that is already agreed.
 */
export function TroubleCard({
  heading,
  note,
  testId,
}: {
  heading: string;
  note: string;
  testId: string;
}) {
  return (
    <div className="wrap">
      <div className="card">
        <div className="login-view trouble" data-testid={testId}>
          <div className="login-lockup">
            <Image src="/logo.png" alt="" width={52} height={52} priority />
            <div className="wordmark">
              <span className="power">Power</span>
              <span className="analytix">Analytix</span>
            </div>
          </div>
          <div className="login-title" data-testid="product-name">
            Power Suite
          </div>

          <h1 className="card-title">{heading}</h1>
          <p className="card-note">{note}</p>
          <p className="back">
            <Link href="/">Back to Power Suite</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

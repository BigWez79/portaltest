"use client";

import { useEffect } from "react";
import { TroubleCard } from "@/components/TroubleCard";

/**
 * What a crash looks like. Next's own overlay is a development affordance; in
 * production its fallback is the same unstyled page as the 404, and a crash is
 * exactly the moment a page starts saying more than it meant to.
 *
 * So: the digest to the console, and nothing to the person but a way back. The
 * digest is a hash Next puts on the error so a report can be matched to the
 * stack in the server log — it is not the message, and the message itself never
 * crosses to the browser in a production build. Even so it is logged rather than
 * rendered, because a string on the page is a string somebody can paste into an
 * issue, and the 404 above it is careful for the same reason.
 *
 * `reset` is deliberately not rendered. A "try again" button is the normal thing
 * here, but this boundary sits over guarded routes, and a second button is a
 * second thing to reason about on the screen somebody sees when something has
 * already gone wrong. The way back is the link.
 */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(`[error] render failed — digest ${error.digest ?? "none"}`);
  }, [error]);

  return (
    <main className="shell gated">
      <TroubleCard
        testId="crashed"
        heading="Something went wrong"
        note="That is on us, not on you. Nothing you were doing elsewhere is affected. Try again in a moment."
      />
    </main>
  );
}

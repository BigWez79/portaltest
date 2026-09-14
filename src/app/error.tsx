"use client";

import { useEffect } from "react";
import { DeadEnd } from "@/components/DeadEnd";

/**
 * A failure anywhere below the root layout. Client components only — this is an
 * error boundary, and a boundary runs in the browser.
 *
 * The digest goes to the console and nothing goes on the page. The digest is
 * the tie between what the person saw and the entry in the server log; the
 * message is not, and in a production build Next has already withheld it.
 */
export default function AppError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(`[error] a page failed to render — digest ${error.digest ?? "none"}`);
  }, [error]);

  return (
    <DeadEnd
      testId="crashed"
      title="Something went wrong"
      note="That one is on us. Head back and try again — and if it keeps happening, tell an administrator."
    />
  );
}

"use client";

import { useEffect } from "react";
import { DeadEnd } from "@/components/DeadEnd";
import { albertSans, sora } from "./brand-fonts";
import "./globals.css";

/**
 * The one failure error.tsx cannot catch: the root layout itself. It replaces
 * the whole document, which is why it carries its own <html>, its own <body>,
 * its own stylesheet and its own fonts — everything layout.tsx would have set
 * is exactly what is missing.
 *
 * It is not exercised by the suite. Nothing in the app can be made to break the
 * root layout on demand without shipping a way to break the root layout, and
 * the markup it renders is the same DeadEnd the 404 and error.tsx render, which
 * is covered. What is untested here is the wrapper: the <html>, the fonts and
 * the stylesheet import.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(`[global-error] the root layout failed — digest ${error.digest ?? "none"}`);
  }, [error]);

  return (
    <html lang="en-GB" className={`${sora.variable} ${albertSans.variable}`}>
      <body>
        <DeadEnd
          testId="crashed"
          title="Something went wrong"
          note="That one is on us. Head back and try again — and if it keeps happening, tell an administrator."
        />
      </body>
    </html>
  );
}

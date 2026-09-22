"use client";

import { useEffect } from "react";

/**
 * The last boundary. `error.tsx` renders inside the root layout, so it cannot
 * catch a failure in the root layout itself — this one replaces the whole
 * document instead, which is why it carries its own <html> and <body>.
 *
 * That also means globals.css and the self-hosted fonts are not there: the
 * layout that imports them is the thing that failed. The styles are inline and
 * use the same tokens by hand, so the page still reads as Power Suite rather
 * than as a stack trace on white.
 *
 * Nothing in the suite can exercise this at 3am — provoking it means breaking
 * the root layout, and a test that shipped a broken root layout to prove the
 * fallback works would be its own outage. It is reviewed by reading it.
 */
const page: React.CSSProperties = {
  margin: 0,
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "28px 18px",
  background: "#eef2fb",
  color: "#10183a",
  fontFamily: "system-ui, sans-serif",
};

const card: React.CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  background: "#ffffff",
  border: "1px solid #dde4f3",
  borderRadius: "16px",
  padding: "22px",
  textAlign: "center",
};

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(`[global-error] the root layout failed — digest ${error.digest ?? "none"}`);
  }, [error]);

  return (
    <html lang="en-GB">
      <body style={page}>
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: "19px", marginBottom: "8px" }}>
            Power Suite
          </div>
          <h1 style={{ fontWeight: 600, fontSize: "17px", margin: "0 0 4px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "13px", color: "#69718c", margin: "0 0 16px" }}>
            That is on us, not on you. Try again in a moment.
          </p>
          <p style={{ fontSize: "13px", margin: 0 }}>
            <a href="/" style={{ color: "#69718c" }}>
              Back to Power Suite
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}

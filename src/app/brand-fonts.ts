import localFont from "next/font/local";

/**
 * Sora and Albert Sans are self-hosted rather than pulled from Google Fonts.
 * next/font/google fetches the face at build time; an overnight build on a
 * flaky connection then fails on a font. These files are in the repo, so the
 * build needs no network and the page makes no third-party request.
 *
 * They live here rather than in layout.tsx because `global-error.tsx` renders
 * its own <html> — the root layout is the thing that failed, so nothing it set
 * is available — and a crash page in the wrong typeface is a crash page that
 * does not look like the product.
 */
export const sora = localFont({
  src: [
    { path: "./fonts/sora-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/sora-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/sora-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sora",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const albertSans = localFont({
  src: [
    { path: "./fonts/albert-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/albert-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/albert-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-albert-sans",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

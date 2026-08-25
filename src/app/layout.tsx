import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Sora and Albert Sans are self-hosted rather than pulled from Google Fonts.
 * next/font/google fetches the face at build time; an overnight build on a
 * flaky connection then fails on a font. These files are in the repo, so the
 * build needs no network and the page makes no third-party request.
 */
const sora = localFont({
  src: [
    { path: "./fonts/sora-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/sora-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/sora-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sora",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const albertSans = localFont({
  src: [
    { path: "./fonts/albert-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/albert-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/albert-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-albert-sans",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Power Analytix — Portal",
  description: "One sign-in for the whole Power Analytix suite.",
  robots: { index: false, follow: false },
  icons: { icon: "/logo.png" },
};

export const viewport: Viewport = {
  themeColor: "#507DE5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sora.variable} ${albertSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}

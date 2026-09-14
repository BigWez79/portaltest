import type { Metadata, Viewport } from "next";
import { albertSans, sora } from "./brand-fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Power Suite — Power Analytix",
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

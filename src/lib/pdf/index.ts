/**
 * One way to make a PDF.
 *
 * Five documents are queued behind this — the invoice, the expenses claim, and
 * the timesheet's timesheet, invoice and annual statement — and every one of
 * them needs the same seller header, the same money, the same A4 margins and
 * the same logo. Written once here, or written five times and drifting five
 * ways by the third.
 *
 * NOT `server-only`. Client components import it: a PDF is made in the browser
 * from what is already on the screen, so nothing about a document is a round
 * trip and no document needs a route of its own.
 *
 * jsPDF and jspdf-autotable are npm dependencies, imported dynamically. Both
 * parts matter — bundled, because an overnight build must not need cdnjs to be
 * up and a signed-in page should not fetch executable code from a third party;
 * dynamic, because the pair is ~400kB and most visits never press a button
 * that needs them.
 */

import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";

/* -------------------------------------------------------------------------
   The suite's colours, in the form jsPDF wants them
   ------------------------------------------------------------------------- */

/** `--brand` #507de5 — table headings. */
export const PDF_BRAND: [number, number, number] = [80, 125, 229];
/** `--ink` #10183a — anything somebody reads. */
export const PDF_INK: [number, number, number] = [16, 24, 58];
/** `--muted` #69718c — labels, stamps, the small print. */
export const PDF_MUTE: [number, number, number] = [105, 113, 140];
/** The heading blue the live pages print with; kept for documents ported from them. */
export const PDF_HEAD_BLUE: [number, number, number] = [46, 90, 172];

/* -------------------------------------------------------------------------
   Formatting
   ------------------------------------------------------------------------- */

/**
 * Money on a document somebody pays from: exact pence, no thousands
 * separator, which is what the live pages print.
 *
 * Margin keeps its own — it rounds to whole pounds and groups thousands,
 * because it is a planning figure rather than an amount anybody transfers.
 * Two formatters is right here; one would make an invoice say £1,234 or a
 * margin report say £1234567.00.
 */
export const money = (n: number | string | null | undefined) =>
  "£" + (Number(n) || 0).toFixed(2);

/** "9 Jul 2026" — expenses and timesheets. */
export function shortDate(value: string | Date | null | undefined): string {
  const d = value instanceof Date ? value : new Date(String(value ?? ""));
  if (isNaN(d.getTime())) return String(value ?? "");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "9 July 2026" — invoices, which spell the month out. */
export function longDate(value: string | Date | null | undefined): string {
  const d = value instanceof Date ? value : new Date(String(value ?? ""));
  if (isNaN(d.getTime())) return String(value ?? "");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** "2026-07" -> "July 2026". */
export function monthName(ym: string): string {
  const [y, m] = String(ym ?? "").split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (isNaN(d.getTime())) return String(ym ?? "");
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/**
 * A person's name, safe to put in a filename.
 *
 * The same expression the live pages use. It is deliberately blunt — every
 * character that is not a letter or a digit becomes an underscore — because a
 * filename is not the place to discover that somebody's business has a slash
 * in its name.
 */
export const safeFilePart = (s: string | null | undefined) =>
  String(s ?? "").replace(/[^a-z0-9]/gi, "_") || "untitled";

/* -------------------------------------------------------------------------
   The document
   ------------------------------------------------------------------------- */

export type PdfUnit = "pt" | "mm";

export type PdfKit = {
  doc: jsPDF;
  autoTable: (doc: jsPDF, options: UserOptions) => void;
  /** Page width in the document's own unit. */
  pageW: number;
  pageH: number;
  /** The side margin every helper here works to. */
  margin: number;
};

/** jsPDF records where the last table ended, but not in a type anybody exported. */
type WithLastTable = { lastAutoTable?: { finalY: number } };

/** Where the last `autoTable` finished, or the fallback if none has run. */
export const lastY = (doc: jsPDF, fallback = 0): number =>
  (doc as unknown as WithLastTable).lastAutoTable?.finalY ?? fallback;

/**
 * A4, portrait, in the unit the caller asks for.
 *
 * Both units are offered rather than one being imposed because the documents
 * this replaces are split: Margin was written in points, and the invoice,
 * claim and timesheet were written in millimetres. Converting either would
 * move every coordinate in a document that is already correct, to gain
 * nothing a reader would notice.
 */
export async function createPdf(unit: PdfUnit = "mm", margin?: number): Promise<PdfKit> {
  const [{ jsPDF: JsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new JsPDF({ unit, format: "a4" });
  return {
    doc,
    autoTable,
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
    margin: margin ?? (unit === "mm" ? 15 : 40),
  };
}

/** Table styling every document here shares. Spread it and override what differs. */
export function tableDefaults(kit: PdfKit, fill = PDF_HEAD_BLUE): UserOptions {
  return {
    headStyles: { fillColor: fill, textColor: 255 },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2 },
    margin: { left: kit.margin, right: kit.margin },
  };
}

/* -------------------------------------------------------------------------
   The seller block
   ------------------------------------------------------------------------- */

/**
 * Who the document is from. Every field is optional because My Profile lets
 * every field be blank, and a half-filled profile should still produce a
 * document rather than a crash — the readiness panel on that screen is what
 * tells somebody the invoice will be short, at a point where they can fix it.
 */
export type PdfSeller = {
  businessName?: string | null;
  tagline?: string | null;
  businessAddress?: string | null;
  companyNumber?: string | null;
  vatNumber?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  accountName?: string | null;
  sortCode?: string | null;
  accountNo?: string | null;
  /** A data URL, PNG, as My Profile stores it. */
  logo?: string | null;
};

/**
 * The logo and the document's title, across the top.
 *
 * Returns the y to carry on from, which is below whichever of the two is
 * taller. A caller that assumed a fixed height would overprint the moment
 * somebody uploaded a square logo.
 */
export function drawSellerHeader(
  kit: PdfKit,
  opts: { seller: PdfSeller; title: string; y?: number },
): number {
  const { doc, pageW, margin } = kit;
  const y = opts.y ?? margin;
  let logoBottom = y;

  const logo = opts.seller.logo;
  if (logo) {
    try {
      const props = doc.getImageProperties(logo);
      // A fraction of the page rather than a fixed number, so this is the same
      // size whether the document is in points or millimetres.
      const w = pageW * 0.16;
      const h = w * (props.height / props.width);
      doc.addImage(logo, "PNG", margin, y, w, h);
      logoBottom = y + h;
    } catch {
      // A logo that will not decode is not a reason to withhold an invoice.
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...PDF_INK);
  doc.text(opts.title, pageW - margin, y + 6, { align: "right" });

  const name = opts.seller.businessName;
  if (name && !logo) {
    doc.setFontSize(12);
    doc.text(name, margin, y + 6);
    logoBottom = Math.max(logoBottom, y + 6);
  }

  const tag = opts.seller.tagline;
  if (tag) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_MUTE);
    doc.text(tag, margin, logoBottom + 5);
    logoBottom += 5;
  }

  doc.setTextColor(...PDF_INK);
  return Math.max(logoBottom, y + 10);
}

/** The small grey line along the bottom. */
export function drawFooter(kit: PdfKit, text: string, y?: number): void {
  const { doc, margin, pageH } = kit;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_MUTE);
  doc.text(text, margin, y ?? pageH - margin / 2);
  doc.setTextColor(...PDF_INK);
}

import {
  createPdf,
  drawFooter,
  drawSellerHeader,
  lastY,
  money,
  PDF_MUTE,
  periodFileTag,
  safeFilePart,
  shortDate,
  tableDefaults,
  type PdfSeller,
} from "@/lib/pdf";
import {
  daysWorked,
  isFullDay,
  periodLabel,
  type Period,
  type TimesheetEntry,
} from "@/lib/timesheets-calc";

/**
 * The three documents a timesheet produces, from `timesheet.html` lines 1278,
 * 1399 and 1581.
 *
 * They are three because they answer three questions to three audiences. The
 * timesheet is the record — what was done, when. The invoice is the bill — what
 * is owed for it. The statement is the year — what a person did across it. Any
 * one of them standing in for the others loses something somebody needs.
 */

export type TimesheetDoc = {
  entries: TimesheetEntry[];
  period: Period;
  periodKey: string;
  person: { name: string | null; email: string };
  seller: PdfSeller;
};

const byDate = (a: TimesheetEntry, b: TimesheetEntry) => a.entryDate.localeCompare(b.entryDate);

const hrs = (n: number) => `${Number(n.toFixed(2))} h`;

/* ------------------------------- the record ------------------------------ */

export async function downloadTimesheetPdf(doc: TimesheetDoc) {
  const kit = await createPdf("mm");
  const { doc: pdf, autoTable } = kit;
  const rows = [...doc.entries].sort(byDate);

  let y = drawSellerHeader(kit, { seller: doc.seller, title: "Timesheet" });
  y = headerBlock(kit, doc, y);

  autoTable(pdf, {
    ...tableDefaults(kit),
    startY: y,
    head: [
      [
        "Date",
        "Activity",
        "Project",
        "What was done",
        { content: "Hours", styles: { halign: "right" } },
      ],
    ],
    body: rows.map((e) => [
      shortDate(e.entryDate),
      e.activityType,
      e.project ?? "",
      e.workDescription ?? "",
      hrs(e.hoursWorked),
    ]),
    columnStyles: { 4: { halign: "right" } },
  });

  const total = rows.reduce((n, e) => n + e.hoursWorked, 0);
  const away = rows.filter((e) => isFullDay(e.activityType)).reduce((n, e) => n + e.hoursWorked, 0);

  let ty = lastY(pdf, y) + 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  ty = totalLine(kit, "Worked", hrs(total - away), ty);
  ty = totalLine(kit, "Leave and sickness", hrs(away), ty);
  ty = totalLine(kit, "Billable days", String(daysWorked(rows)), ty, true);

  drawFooter(kit, "A record of hours logged. Not a request for payment.", ty + 10);
  pdf.save(`Timesheet_${safeFilePart(doc.person.name || doc.person.email)}_${periodFileTag(doc.period, doc.periodKey)}.pdf`);
}

/* ------------------------------- the bill -------------------------------- */

export async function downloadTimesheetInvoicePdf(
  doc: TimesheetDoc & { dayRate: number; vatRate: number; draft: boolean },
) {
  const kit = await createPdf("mm");
  const { doc: pdf, autoTable, pageW, margin } = kit;

  let y = drawSellerHeader(kit, {
    seller: doc.seller,
    title: doc.draft ? "DRAFT INVOICE" : "INVOICE",
  });
  y = headerBlock(kit, doc, y);

  // Billable days, one line each, because that is what is being charged for —
  // an invoice reading "21 days" gives a customer nothing to check against.
  const days = new Map<string, TimesheetEntry[]>();
  for (const e of [...doc.entries].sort(byDate)) {
    if (isFullDay(e.activityType)) continue;
    if (!days.has(e.entryDate)) days.set(e.entryDate, []);
    days.get(e.entryDate)!.push(e);
  }

  autoTable(pdf, {
    ...tableDefaults(kit),
    startY: y,
    head: [["Date", "Work", { content: "Rate", styles: { halign: "right" } }, { content: "Amount", styles: { halign: "right" } }]],
    body: [...days.entries()].map(([date, list]) => [
      shortDate(date),
      [...new Set(list.map((e) => e.project || e.activityType))].join(", "),
      money(doc.dayRate),
      money(doc.dayRate),
    ]),
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
  });

  const count = days.size;
  const net = Math.round(count * doc.dayRate * 100) / 100;
  const vat = Math.round(net * (doc.vatRate / 100) * 100) / 100;

  let ty = lastY(pdf, y) + 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  ty = totalLine(kit, `${count} ${count === 1 ? "day" : "days"} at ${money(doc.dayRate)}`, money(net), ty);
  ty = totalLine(kit, `VAT at ${doc.vatRate}%`, money(vat), ty);
  ty = totalLine(kit, "Total", money(net + vat), ty, true);

  if (doc.draft) {
    // Said in words rather than drawn as a watermark: a watermark is the first
    // thing lost when somebody prints to greyscale or screenshots a page, and
    // this line has to survive being forwarded.
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("DRAFT — not yet issued. Do not pay against this document.", margin, ty + 10);
    ty += 10;
  }

  drawFooter(
    kit,
    doc.draft ? "Issue this from Timesheets to raise the real invoice." : "Thank you for your business.",
    ty + 10,
  );
  pdf.save(
    `${doc.draft ? "Invoice_DRAFT_" : "Invoice_"}${safeFilePart(doc.person.name || doc.person.email)}_${periodFileTag(doc.period, doc.periodKey)}.pdf`,
  );
}

/* ------------------------------ the year --------------------------------- */

export async function downloadStatementPdf(doc: TimesheetDoc & { dayRate: number | null }) {
  const kit = await createPdf("mm");
  const { doc: pdf, autoTable } = kit;

  let y = drawSellerHeader(kit, { seller: doc.seller, title: "ANNUAL STATEMENT" });
  y = headerBlock(kit, doc, y);

  // By month, because a year of days is not something anybody reads row by row.
  const months = new Map<string, TimesheetEntry[]>();
  for (const e of [...doc.entries].sort(byDate)) {
    const m = e.entryDate.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(e);
  }

  autoTable(pdf, {
    ...tableDefaults(kit),
    startY: y,
    head: [
      [
        "Month",
        { content: "Worked", styles: { halign: "right" } },
        { content: "Away", styles: { halign: "right" } },
        { content: "Billable days", styles: { halign: "right" } },
        { content: "Value", styles: { halign: "right" } },
      ],
    ],
    body: [...months.entries()].map(([m, list]) => {
      const away = list.filter((e) => isFullDay(e.activityType)).reduce((n, e) => n + e.hoursWorked, 0);
      const all = list.reduce((n, e) => n + e.hoursWorked, 0);
      const d = daysWorked(list);
      return [
        new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        hrs(all - away),
        hrs(away),
        String(d),
        doc.dayRate == null ? "—" : money(d * doc.dayRate),
      ];
    }),
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });

  const total = doc.entries.reduce((n, e) => n + e.hoursWorked, 0);
  const away = doc.entries.filter((e) => isFullDay(e.activityType)).reduce((n, e) => n + e.hoursWorked, 0);
  const d = daysWorked(doc.entries);

  let ty = lastY(pdf, y) + 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  ty = totalLine(kit, "Hours worked", hrs(total - away), ty);
  ty = totalLine(kit, "Leave and sickness", hrs(away), ty);
  ty = totalLine(kit, "Billable days", String(d), ty);
  if (doc.dayRate != null) ty = totalLine(kit, "At the current day rate", money(d * doc.dayRate), ty, true);

  drawFooter(kit, "A summary of the financial year to date. Not a request for payment.", ty + 10);
  pdf.save(`Statement_${safeFilePart(doc.person.name || doc.person.email)}_${periodFileTag(doc.period, doc.periodKey)}.pdf`);
}

/* ------------------------------- shared ---------------------------------- */

function headerBlock(
  kit: Awaited<ReturnType<typeof createPdf>>,
  doc: TimesheetDoc,
  y: number,
): number {
  const { doc: pdf, pageW, margin } = kit;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text("Period", pageW - margin - 45, margin + 14);
  pdf.text(periodLabel(doc.period, doc.periodKey), pageW - margin, margin + 14, { align: "right" });
  pdf.text("Generated", pageW - margin - 45, margin + 20);
  pdf.text(new Date().toLocaleDateString("en-GB"), pageW - margin, margin + 20, { align: "right" });

  const top = Math.max(y, margin + 22) + 8;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(doc.person.name || doc.person.email, margin, top);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(...PDF_MUTE);
  pdf.text(doc.person.email, margin, top + 5);
  pdf.setTextColor(0, 0, 0);
  return top + 12;
}

function totalLine(
  kit: Awaited<ReturnType<typeof createPdf>>,
  label: string,
  value: string,
  y: number,
  strong = false,
): number {
  const { doc: pdf, pageW, margin } = kit;
  pdf.setFont("helvetica", strong ? "bold" : "normal");
  pdf.setFontSize(strong ? 12 : 10);
  pdf.text(`${label}:`, pageW - margin - 34, y, { align: "right" });
  pdf.text(value, pageW - margin, y, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  return y + (strong ? 8 : 6);
}

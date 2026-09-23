import {
  createPdf,
  drawFooter,
  drawSellerHeader,
  lastY,
  money,
  monthName,
  PDF_MUTE,
  safeFilePart,
  shortDate,
  tableDefaults,
  type PdfSeller,
} from "@/lib/pdf";
import type { Expense } from "@/lib/expenses-calc";

/**
 * The monthly expenses claim, transcribed from `expenses.html:renderClaimPDF`.
 *
 * Two tables, not one, and that is the whole shape of the document: mileage is
 * a route and a distance priced at a rate, everything else is a receipt for an
 * amount. Putting them in one table means a Miles column that is empty on most
 * rows and a Receipt column that is meaningless on the rest.
 *
 * Each is subtotalled before the total, because those two numbers get checked
 * against different things — the mileage subtotal against the rate and the
 * distance, the other against a pile of receipts.
 */

export type ClaimPerson = { name: string | null; email: string };

export async function downloadClaimPdf(opts: {
  month: string;
  rows: Expense[];
  person: ClaimPerson;
  seller: PdfSeller;
}) {
  const { month, rows, person, seller } = opts;

  const mileage = rows.filter((r) => r.expenseType === "Mileage");
  const other = rows.filter((r) => r.expenseType !== "Mileage");
  const sum = (list: Expense[]) => list.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const mileTotal = sum(mileage);
  const otherTotal = sum(other);

  const kit = await createPdf("mm");
  const { doc, autoTable, pageW, pageH, margin } = kit;

  let y = drawSellerHeader(kit, { seller, title: "EXPENSES CLAIM" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Claim for", pageW - margin - 40, margin + 14);
  doc.text(monthName(month), pageW - margin, margin + 14, { align: "right" });
  doc.text("Generated", pageW - margin - 40, margin + 20);
  doc.text(new Date().toLocaleDateString("en-GB"), pageW - margin, margin + 20, { align: "right" });

  y = Math.max(y, margin + 22) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(person.name || person.email, margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_MUTE);
  doc.text(person.email, margin, y + 5);
  doc.setTextColor(0, 0, 0);

  let ty = y + 12;

  if (mileage.length > 0) {
    autoTable(doc, {
      ...tableDefaults(kit),
      startY: ty,
      head: [
        [
          "Date",
          "Route",
          { content: "Miles", styles: { halign: "right" } },
          { content: "Amount", styles: { halign: "right" } },
        ],
      ],
      body: mileage.map((r) => [
        shortDate(r.expenseDate),
        r.fromLocation || r.toLocation ? `${r.fromLocation ?? "?"} to ${r.toLocation ?? "?"}` : "",
        String(r.miles ?? 0),
        money(r.amount),
      ]),
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
    });
    ty = lastY(doc, ty) + 6;
  }

  if (other.length > 0) {
    autoTable(doc, {
      ...tableDefaults(kit),
      startY: ty,
      head: [
        ["Date", "Type", "Description", "Receipt", { content: "Amount", styles: { halign: "right" } }],
      ],
      body: other.map((r) => [
        shortDate(r.expenseDate),
        r.expenseType,
        r.reason ?? "",
        r.receiptHeld ? "Yes" : "No",
        money(r.amount),
      ]),
      columnStyles: { 4: { halign: "right" } },
    });
    ty = lastY(doc, ty) + 6;
  }

  ty += 4;
  // The totals must not be orphaned onto a page of their own with the
  // declaration, and they must not be cut in half either.
  if (ty > pageH - 45) {
    doc.addPage();
    ty = margin;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (mileage.length > 0) {
    doc.text("Mileage subtotal:", pageW - margin - 32, ty, { align: "right" });
    doc.text(money(mileTotal), pageW - margin, ty, { align: "right" });
    ty += 6;
  }
  if (other.length > 0) {
    doc.text("Other subtotal:", pageW - margin - 32, ty, { align: "right" });
    doc.text(money(otherTotal), pageW - margin, ty, { align: "right" });
    ty += 6;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Total to claim (GBP):", pageW - margin - 32, ty + 2, { align: "right" });
  doc.text(money(mileTotal + otherTotal), pageW - margin, ty + 2, { align: "right" });

  drawFooter(
    kit,
    "I confirm these expenses were incurred wholly and necessarily for business.",
    ty + 16,
  );

  doc.save(`PowerAnalytix-expenses-${month}-${safeFilePart(person.name || person.email)}.pdf`);
}

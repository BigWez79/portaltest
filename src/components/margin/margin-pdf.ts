import { formatStamp, gbp, type MarginResult } from "@/lib/margin-model";

/**
 * The PDF report, transcribed from the live page's `downloadPDF()`.
 *
 * jsPDF and jspdf-autotable came from cdnjs there. They are npm dependencies
 * here and bundled with the app: an overnight build must not need cdnjs to be
 * up, and a signed-in page should not be fetching executable code from a third
 * party. They are imported dynamically so the ~400kB only loads when somebody
 * actually presses Download PDF.
 */
type FinalY = { lastAutoTable?: { finalY: number } };

export async function downloadMarginPdf(result: MarginResult, scenarioName: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const L = result;
  const name = scenarioName.trim() || "Scenario";
  const stampIso = new Date().toISOString();
  const g = (n: number) => gbp(n || 0);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 40;
  let y = 46;
  const BLUE: [number, number, number] = [80, 125, 229];
  const INK: [number, number, number] = [16, 24, 58];
  const MUTE: [number, number, number] = [105, 113, 140];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text("Operating Margin & Profit Split", M, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTE);
  y += 16;
  doc.text(`Scenario: ${name}   ·   Generated ${formatStamp(stampIso)}`, M, y);
  y += 13;
  doc.text(
    `${L.periodLabel === "per year" ? "Annual view" : "Quarterly view"}` +
      `   ·   Quarter: ${L.quarterRange || "—"}` +
      `   ·   Working days available: ${L.availTotal || 0}`,
    M,
    y,
  );
  y += 10;

  const money = { halign: "right" as const };
  const finalY = () => (doc as unknown as FinalY).lastAutoTable?.finalY ?? y;

  autoTable(doc, {
    startY: y + 8,
    head: [["Summary", "Amount"]],
    body: [
      ["Revenue (base)", g(L.revBase)],
      ["Carryover", "+ " + g(L.carryTotal)],
      ["Staff cost (business)", "- " + g(L.staff)],
      [`Operating margin (${L.marginPc.toFixed(1)}%)`, g(L.margin)],
      ["Investments", "- " + g(L.invTotal)],
      ["Distributable profit", g(L.net)],
      ["Debts repaid to owners", "- " + g(L.debtTotal)],
      [`${L.nameA} staff credit`, "- " + g(L.credA)],
      [`${L.nameB} staff credit`, "- " + g(L.credB)],
      ["50/50 unclaimed-days pool", "- " + g(L.fiftyTotal)],
      ["Profit to split", g(L.splitPot)],
    ],
    columnStyles: { 1: money },
    headStyles: { fillColor: BLUE, halign: "left" },
    styles: { fontSize: 9, cellPadding: 4 },
    theme: "grid",
    margin: { left: M, right: M },
  });

  const staffRows = L.rows.map((s) => [
    s.name,
    g(s.rate),
    String(s.m1),
    String(s.m2),
    String(s.m3),
    String(s.days),
    g(s.cost),
    s.owner === "A" ? L.nameA : s.owner === "B" ? L.nameB : "—",
    s.fifty ? "Yes" : "—",
  ]);

  autoTable(doc, {
    startY: finalY() + 18,
    head: [["Staff", "Rate", "M1", "M2", "M3", "Days", "Qtr cost", "Credited to", "50/50"]],
    body: staffRows.length ? staffRows : [["—", "", "", "", "", "", "", "", ""]],
    columnStyles: { 1: money, 6: money },
    headStyles: { fillColor: BLUE },
    styles: { fontSize: 8.5, cellPadding: 3.5 },
    theme: "grid",
    margin: { left: M, right: M },
  });

  autoTable(doc, {
    startY: finalY() + 18,
    head: [["Owner", "% of split", "Profit share", "Staff credit", "Debt back", "50/50", "Total"]],
    body: [
      [L.nameA, `${L.aPc}%`, g(L.shareA), g(L.credA), g(L.debtATotal), g(L.half), g(L.totalA)],
      [L.nameB, `${L.bPc}%`, g(L.shareB), g(L.credB), g(L.debtBTotal), g(L.half), g(L.totalB)],
      [
        "Total",
        "",
        g(L.shareA + L.shareB),
        g(L.credA + L.credB),
        g(L.debtTotal),
        g(L.half * 2),
        g(L.totalDist),
      ],
    ],
    columnStyles: { 2: money, 3: money, 4: money, 5: money, 6: money },
    headStyles: { fillColor: BLUE },
    styles: { fontSize: 9, cellPadding: 4 },
    theme: "grid",
    margin: { left: M, right: M },
  });

  doc.setFontSize(8);
  doc.setTextColor(...MUTE);
  doc.text(
    "Power Analytix · figures in GBP · total distributed reconciles to distributable profit.",
    M,
    finalY() + 18,
  );

  doc.save(name.replace(/[^\w-]+/g, "_") + "_margin_split.pdf");
}

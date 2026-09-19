/** The tile glyphs. The first four are verbatim from portal v2.0. */
export function TileIcon({ id }: { id: string }) {
  switch (id) {
    case "invoices":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </svg>
      );
    case "timesheet":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "expenses":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </svg>
      );
    case "margin":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 19L19 5" />
          <circle cx="7.5" cy="7.5" r="2.5" />
          <circle cx="16.5" cy="16.5" r="2.5" />
        </svg>
      );
    case "taxBreakdown":
      // A pie with one slice pulled out — a breakdown, and not another document
      // shape that reads like the Invoices glyph at tile size.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 4.2A8 8 0 1 0 19.8 13H11Z" />
          <path d="M14.5 3.2A8 8 0 0 1 21 9.7l-6.5 1.3Z" />
        </svg>
      );
    case "overview":
      // A month with bars in it. The Expenses glyph is also a rectangle, so
      // this one carries the two date tabs and the bars to tell them apart at
      // tile size.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
          <path d="M8 17.5v-2.5M12 17.5v-4.5M16 17.5v-1.5" />
        </svg>
      );
    case "profile":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case "admin":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l7 4v5c0 4.4-3 8.2-7 9-4-.8-7-4.6-7-9V7l7-4Z" />
          <path d="M9.5 12l2 2 3.5-3.5" />
        </svg>
      );
    default:
      return null;
  }
}

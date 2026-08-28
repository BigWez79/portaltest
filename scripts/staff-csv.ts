/**
 * The CSV half of the one-off staff import, with nothing else attached: no
 * filesystem, no Supabase, no argv. It is a separate file so it can be tested,
 * because `scripts/import-staff.ts` runs once, against production, and sets the
 * access flags for every member of staff.
 *
 * Its failure mode is the quiet one. A mis-parsed column does not crash — it
 * grants the wrong people the wrong apps, and `--dry-run` prints counts rather
 * than rows, so nothing would look wrong. `tests/import-staff-csv.spec.ts` pins
 * the mapping instead.
 *
 * Warnings are returned rather than printed for the same reason: a test can
 * read them, and the caller decides where they go.
 *
 * This file goes when the import script goes — see TASKS.md, "Delete the import
 * script at cutover".
 */

/** Minimal RFC-4180 reader: quoted fields, escaped quotes, embedded commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export const truthy = (v: string) => /^(yes|true|1|y)$/i.test(v.trim());

export type Row = {
  email: string;
  full_name: string | null;
  active: boolean;
  is_admin: boolean;
  has_invoices: boolean;
  has_timesheet: boolean;
  has_expenses: boolean;
};

export type Parsed = {
  rows: Row[];
  /** One line per skipped row, in file order. Printed by the script. */
  warnings: string[];
};

export function toRows(csv: string): Parsed {
  const [header, ...body] = parseCsv(csv);
  if (!header) throw new Error("The file is empty.");

  const index = (...names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const cols = {
    email: index("Title", "Email", "Address"),
    name: index("OfficialName", "Official Name", "Name", "Full Name"),
    active: index("Active"),
    isAdmin: index("IsAdmin", "Is Admin", "Admin"),
    invoices: index("HasInvoices", "Invoices"),
    timesheet: index("HasTimesheet", "Timesheets", "Timesheet"),
    expenses: index("HasExpenses", "Expenses"),
  };

  if (cols.email === -1) {
    throw new Error(
      `No email column. Looked for Title, Email or Address; found: ${header.join(", ")}`,
    );
  }

  const seen = new Set<string>();
  const rows: Row[] = [];
  const warnings: string[] = [];

  for (const [n, line] of body.entries()) {
    const cell = (i: number) => (i === -1 ? "" : (line[i] ?? "").trim());
    const email = cell(cols.email).toLowerCase();

    if (!email) {
      warnings.push(`line ${n + 2}: no address, skipped`);
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      warnings.push(`line ${n + 2}: "${email}" is not an address, skipped`);
      continue;
    }
    if (seen.has(email)) {
      warnings.push(`line ${n + 2}: ${email} appears twice, later one skipped`);
      continue;
    }
    seen.add(email);

    rows.push({
      email,
      full_name: cell(cols.name) || null,
      active: truthy(cell(cols.active)),
      is_admin: truthy(cell(cols.isAdmin)),
      has_invoices: truthy(cell(cols.invoices)),
      has_timesheet: truthy(cell(cols.timesheet)),
      has_expenses: truthy(cell(cols.expenses)),
    });
  }

  return { rows, warnings };
}

export type Summary = {
  total: number;
  active: number;
  admins: number;
  invoices: number;
  timesheet: number;
  expenses: number;
  /**
   * True when nothing in the file can reach the admin screen. BOOTSTRAP_ADMINS
   * is then the only way back in, so the script says so before it writes.
   */
  noActiveAdmin: boolean;
};

export function summarise(rows: Row[]): Summary {
  const admins = rows.filter((r) => r.active && r.is_admin).length;
  return {
    total: rows.length,
    active: rows.filter((r) => r.active).length,
    admins,
    invoices: rows.filter((r) => r.has_invoices).length,
    timesheet: rows.filter((r) => r.has_timesheet).length,
    expenses: rows.filter((r) => r.has_expenses).length,
    noActiveAdmin: admins === 0,
  };
}

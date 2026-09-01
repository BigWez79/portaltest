/**
 * The CSV half of the one-off staff import, kept apart from the script so it
 * can be tested without a Supabase connection or a file on disk.
 *
 * Nothing here reads the environment, the filesystem or the network. It takes
 * the text of a CSV and returns rows, warnings and counts; `import-staff.ts`
 * prints those and does the upsert. That split exists because this parser runs
 * once, against production, and decides who gets which app — its failure mode
 * is a quiet one, so it is the part that gets pinned by tests.
 *
 * Expected headers, case-insensitive, extra columns ignored:
 *
 *   Title | Email        the address (the SharePoint list used Title)
 *   OfficialName | Name  the person's name
 *   Active, IsAdmin, HasInvoices, HasTimesheet, HasExpenses
 *                        Yes / No / true / false / 1 / 0
 */

/** A parsed line, with the line number it started on so warnings can name it. */
export type CsvRow = { line: number; cells: string[] };

/**
 * Minimal RFC-4180 reader: quoted fields, escaped quotes, embedded commas and
 * embedded newlines. Blank lines are kept, so `line` stays true to the file.
 * A leading byte-order mark is dropped — SharePoint's Export to CSV writes one.
 */
export function parseCsv(text: string): CsvRow[] {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;

  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(field);
      field = "";
    } else if (c === "\n") {
      cells.push(field);
      rows.push({ line: rowLine, cells });
      cells = [];
      field = "";
      line++;
      rowLine = line;
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || cells.length > 0) {
    cells.push(field);
    rows.push({ line: rowLine, cells });
  }
  return rows;
}

const isBlank = (row: CsvRow) => row.cells.every((cell) => cell.trim() === "");

export const truthy = (v: string) => /^(yes|true|1|y)$/i.test(v.trim());

export type StaffRow = {
  email: string;
  full_name: string | null;
  active: boolean;
  is_admin: boolean;
  has_invoices: boolean;
  has_timesheet: boolean;
  has_expenses: boolean;
};

/** Rows to upsert, plus every line the parser refused and why. */
export type ParsedStaff = { rows: StaffRow[]; warnings: string[] };

export function toRows(csv: string): ParsedStaff {
  const all = parseCsv(csv);
  const header = all.find((row) => !isBlank(row));
  if (!header) throw new Error("The file is empty.");

  const body = all.slice(all.indexOf(header) + 1);

  const index = (...names: string[]) => {
    for (const n of names) {
      const i = header.cells.findIndex(
        (h) => h.trim().toLowerCase() === n.toLowerCase(),
      );
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
      `No email column. Looked for Title, Email or Address; found: ${header.cells.join(", ")}`,
    );
  }

  const seen = new Set<string>();
  const rows: StaffRow[] = [];
  const warnings: string[] = [];

  for (const row of body) {
    if (isBlank(row)) continue;

    const cell = (i: number) => (i === -1 ? "" : (row.cells[i] ?? "").trim());
    const email = cell(cols.email).toLowerCase();

    if (!email) {
      warnings.push(`line ${row.line}: no address, skipped`);
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      warnings.push(`line ${row.line}: "${email}" is not an address, skipped`);
      continue;
    }
    if (seen.has(email)) {
      warnings.push(`line ${row.line}: ${email} appears twice, later one skipped`);
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
  /** No active admin means the only way back in is BOOTSTRAP_ADMINS. */
  noActiveAdmin: boolean;
};

export function summarise(rows: StaffRow[]): Summary {
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

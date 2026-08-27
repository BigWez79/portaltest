/**
 * The CSV half of the one-off staff import — parsing only, so it can be tested
 * without a Supabase connection, a file on disk or an environment variable.
 *
 * `scripts/import-staff.ts` reads the file and writes the rows; everything that
 * decides *what* a row means lives here. Both go at cutover (TASKS.md, portal
 * hygiene 5), along with `tests/import-csv.spec.ts`.
 *
 * Expected headers, case-insensitive, extra columns ignored:
 *
 *   Title | Email        the address (the SharePoint list used Title)
 *   OfficialName | Name  the person's name
 *   Active, IsAdmin, HasInvoices, HasTimesheet, HasExpenses
 *                        Yes / No / true / false / 1 / 0
 *
 * Nothing here prints. Warnings come back with the rows so the caller decides
 * where they go, and so a test can read them.
 */

export type StaffRow = {
  email: string;
  full_name: string | null;
  active: boolean;
  is_admin: boolean;
  has_invoices: boolean;
  has_timesheet: boolean;
  has_expenses: boolean;
};

/** A record and the line of the file it started on — quoted fields may span lines. */
export type CsvRow = {
  line: number;
  cells: string[];
};

export type ParsedStaff = {
  rows: StaffRow[];
  /** One per line that was read and not imported. Print these; do not discard them. */
  warnings: string[];
};

export type StaffSummary = {
  total: number;
  active: number;
  admins: number;
  invoices: number;
  timesheet: number;
  expenses: number;
  /** True when nobody in the file can open the admin screen. */
  noActiveAdmin: boolean;
};

export const NO_ACTIVE_ADMIN_WARNING =
  "No active admin in this file. BOOTSTRAP_ADMINS is the way back in — check it is set before you rely on this.";

/** Minimal RFC-4180 reader: quoted fields, escaped quotes, embedded commas and newlines. */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  // A UTF-8 BOM is what SharePoint's Export to CSV hands you; left in place it
  // would hide the Title column and stop the import dead.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let startedOn = 1;

  const endRow = () => {
    cells.push(field);
    if (cells.some((cell) => cell.trim() !== "")) rows.push({ line: startedOn, cells });
    cells = [];
    field = "";
    startedOn = line;
  };

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
      line++;
      endRow();
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || cells.length > 0) endRow();

  return rows;
}

export const truthy = (v: string): boolean => /^(yes|true|1|y)$/i.test(v.trim());

export function toRows(csv: string): ParsedStaff {
  const [header, ...body] = parseCsv(csv);
  if (!header) throw new Error("The file is empty.");

  const index = (...names: string[]) => {
    for (const n of names) {
      const i = header.cells.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
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

export function summarise(rows: StaffRow[]): StaffSummary {
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

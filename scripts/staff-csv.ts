/**
 * The reading half of the one-off staff import, kept apart from the script that
 * runs it so it can be tested without a Supabase connection.
 *
 * Nothing in here reads argv, touches the filesystem or reaches the network —
 * text in, rows out. `scripts/import-staff.ts` is the only caller, and both
 * files go in the pull request that cuts the domain over.
 *
 * This runs once, against production, and sets the access flags for every
 * member of staff. Its failure mode is the quiet one: a column the header does
 * not name does not crash, it just leaves everybody without that app. So a
 * column that was looked for and not found is reported rather than shrugged at.
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

export type ParsedStaff = {
  rows: StaffRow[];
  /** Lines read and thrown away, with the reason, in file order. */
  warnings: string[];
  /** Flag columns the header did not name. Everybody loses that app. */
  missingColumns: string[];
};

/**
 * Header names, case-insensitive, first match wins. The SharePoint list put the
 * address in `Title`, which is why that is first.
 */
const COLUMNS = {
  email: ["Title", "Email", "Address"],
  name: ["OfficialName", "Official Name", "Name", "Full Name"],
  active: ["Active"],
  isAdmin: ["IsAdmin", "Is Admin", "Admin"],
  invoices: ["HasInvoices", "Invoices"],
  timesheet: ["HasTimesheet", "Timesheets", "Timesheet"],
  expenses: ["HasExpenses", "Expenses"],
} as const;

/** The columns that grant access. A missing one is silent, so it is reported. */
const FLAG_COLUMNS = ["active", "isAdmin", "invoices", "timesheet", "expenses"] as const;

export type CsvRow = {
  cells: string[];
  /** 1-based line the row started on, so a warning points at the right line. */
  line: number;
};

/**
 * Minimal RFC-4180 reader: quoted fields, escaped quotes, embedded commas and
 * embedded newlines. Blank lines are dropped; the line numbers are not, because
 * a warning that names the wrong line is worse than no warning.
 *
 * A byte order mark is stripped first — Excel and SharePoint both write one,
 * and with it in place the first header is `\uFEFFTitle` and matches nothing.
 */
export function parseCsv(text: string): CsvRow[] {
  const body = text.replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
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
      rows.push({ cells, line: rowStart });
      cells = [];
      field = "";
      line++;
      rowStart = line;
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || cells.length > 0) {
    cells.push(field);
    rows.push({ cells, line: rowStart });
  }

  return rows.filter((r) => r.cells.some((cell) => cell.trim() !== ""));
}

const truthy = (v: string) => /^(yes|true|1|y)$/i.test(v.trim());

/** Reads the exported list. Throws only when there is no list to read at all. */
export function readStaffCsv(text: string): ParsedStaff {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error("The file is empty.");

  const index = (names: readonly string[]) => {
    for (const n of names) {
      const i = header.cells.findIndex(
        (h) => h.trim().toLowerCase() === n.toLowerCase(),
      );
      if (i !== -1) return i;
    }
    return -1;
  };

  const cols = {
    email: index(COLUMNS.email),
    name: index(COLUMNS.name),
    active: index(COLUMNS.active),
    isAdmin: index(COLUMNS.isAdmin),
    invoices: index(COLUMNS.invoices),
    timesheet: index(COLUMNS.timesheet),
    expenses: index(COLUMNS.expenses),
  };

  if (cols.email === -1) {
    throw new Error(
      `No email column. Looked for Title, Email or Address; found: ${header.cells.join(", ")}`,
    );
  }

  const missingColumns = FLAG_COLUMNS.filter((k) => cols[k] === -1).map(
    (k) => COLUMNS[k][0],
  );

  const warnings: string[] = [];
  const seen = new Set<string>();
  const rows: StaffRow[] = [];

  for (const { cells, line } of body) {
    const cell = (i: number) => (i === -1 ? "" : (cells[i] ?? "").trim());
    const email = cell(cols.email).toLowerCase();

    if (!email) {
      warnings.push(`line ${line}: no address, skipped`);
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      warnings.push(`line ${line}: "${email}" is not an address, skipped`);
      continue;
    }
    if (seen.has(email)) {
      warnings.push(`line ${line}: ${email} appears twice, later one skipped`);
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

  return { rows, warnings, missingColumns };
}

export type StaffSummary = {
  people: number;
  active: number;
  admins: number;
  invoices: number;
  timesheet: number;
  expenses: number;
  /** Nobody in the file can reach the admin screen. BOOTSTRAP_ADMINS is the way back in. */
  noActiveAdmin: boolean;
};

export function summarise(rows: StaffRow[]): StaffSummary {
  const admins = rows.filter((r) => r.active && r.is_admin).length;
  return {
    people: rows.length,
    active: rows.filter((r) => r.active).length,
    admins,
    invoices: rows.filter((r) => r.has_invoices).length,
    timesheet: rows.filter((r) => r.has_timesheet).length,
    expenses: rows.filter((r) => r.has_expenses).length,
    noActiveAdmin: admins === 0,
  };
}

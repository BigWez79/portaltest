/**
 * Reading the staff CSV — the parsing half of `scripts/import-staff.ts`, kept
 * apart from it so it can be tested with no Supabase connection and nothing on
 * the filesystem. `tests/staff-csv.spec.ts` pins the mapping.
 *
 * The import runs once, against production, and sets the access flags for every
 * member of staff. Its failure mode is the quiet one: a mis-parsed column does
 * not crash, it grants the wrong people the wrong apps. So anything this reader
 * cannot make sense of comes back as a warning rather than being swallowed.
 *
 * Deleted with the script it serves — and with its spec — at cutover; see
 * "Delete the import script at cutover" in TASKS.md.
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

export type Counts = {
  people: number;
  active: number;
  activeAdmins: number;
  invoices: number;
  timesheet: number;
  expenses: number;
};

export type Reading = {
  rows: StaffRow[];
  /** Everything the reader could not take at face value, in file order. */
  warnings: string[];
  counts: Counts;
};

export const NO_ACTIVE_ADMIN =
  "no active admin in this file. BOOTSTRAP_ADMINS is the way back in — check it is set before you rely on this.";

/** Minimal RFC-4180 reader: quoted fields, escaped quotes, embedded commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Excel and the SharePoint export both write a UTF-8 BOM. Left in place it
  // becomes part of the first header's name, and the email column goes missing.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
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

const truthy = (v: string) => /^(yes|true|1|y)$/i.test(v.trim());

/** The flag columns, in the order they are reported. */
const FLAGS = [
  { key: "active", names: ["Active"] },
  { key: "is_admin", names: ["IsAdmin", "Is Admin", "Admin"] },
  { key: "has_invoices", names: ["HasInvoices", "Invoices"] },
  { key: "has_timesheet", names: ["HasTimesheet", "Timesheets", "Timesheet"] },
  { key: "has_expenses", names: ["HasExpenses", "Expenses"] },
] as const;

/**
 * Reads the whole file. Throws only when there is nothing to work with at all —
 * an empty file, or no column that could hold an address. Everything else is a
 * warning against the line it came from, because the alternative is a silent
 * skip in a run nobody watches line by line.
 */
export function readStaffCsv(csv: string): Reading {
  const [header, ...body] = parseCsv(csv);
  if (!header) throw new Error("The file is empty.");

  const index = (...names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const emailCol = index("Title", "Email", "Address");
  if (emailCol === -1) {
    throw new Error(
      `No email column. Looked for Title, Email or Address; found: ${header.join(", ")}`,
    );
  }
  const nameCol = index("OfficialName", "Official Name", "Name", "Full Name");

  const warnings: string[] = [];
  const flagCols = FLAGS.map((flag) => {
    const i = index(...flag.names);
    if (i === -1) {
      warnings.push(
        `no ${flag.names[0]} column; everybody will be imported with it off`,
      );
    }
    return { key: flag.key, index: i };
  });

  const seen = new Set<string>();
  const rows: StaffRow[] = [];

  for (const [n, line] of body.entries()) {
    const cell = (i: number) => (i === -1 ? "" : (line[i] ?? "").trim());
    const email = cell(emailCol).toLowerCase();
    const at = `line ${n + 2}`;

    if (!email) {
      warnings.push(`${at}: no address, skipped`);
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      warnings.push(`${at}: "${email}" is not an address, skipped`);
      continue;
    }
    if (seen.has(email)) {
      warnings.push(`${at}: ${email} appears twice, later one skipped`);
      continue;
    }
    seen.add(email);

    const row: StaffRow = {
      email,
      full_name: cell(nameCol) || null,
      active: false,
      is_admin: false,
      has_invoices: false,
      has_timesheet: false,
      has_expenses: false,
    };
    for (const col of flagCols) row[col.key] = truthy(cell(col.index));
    rows.push(row);
  }

  const counts: Counts = {
    people: rows.length,
    active: rows.filter((r) => r.active).length,
    activeAdmins: rows.filter((r) => r.active && r.is_admin).length,
    invoices: rows.filter((r) => r.has_invoices).length,
    timesheet: rows.filter((r) => r.has_timesheet).length,
    expenses: rows.filter((r) => r.has_expenses).length,
  };

  if (counts.activeAdmins === 0) warnings.push(NO_ACTIVE_ADMIN);

  return { rows, warnings, counts };
}

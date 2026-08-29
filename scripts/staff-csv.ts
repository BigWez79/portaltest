/**
 * The CSV half of `import-staff.ts`, kept separate so it can be tested.
 *
 * Nothing in here reads a file, reaches Supabase or writes to the console: it
 * takes the text of a CSV and returns rows plus the warnings a person needs to
 * read before the import runs. That is the whole point — the import runs once,
 * against production, and sets the access flags for every member of staff, so
 * the mapping below is pinned by `tests/staff-csv.spec.ts` rather than trusted.
 *
 * This file goes when `import-staff.ts` goes, at cutover (TASKS.md P5).
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
  /** Lines that were dropped, and columns that were not imported. */
  warnings: string[];
};

/** Minimal RFC-4180 reader: quoted fields, escaped quotes, embedded commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // A SharePoint export is UTF-8 with a byte order mark, which would otherwise
  // ride along on the first header and stop "Title" being found.
  const body = text.replace(/^\uFEFF/, "");

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
  // Blank lines are kept, so that a warning can name the line the person is
  // looking at in their spreadsheet. They are skipped when rows are read.
  return rows;
}

const isBlank = (row: string[]) => row.every((cell) => cell.trim() === "");

/** Yes / true / 1 / y, in any case. Everything else, including blank, is false. */
export const truthy = (v: string) => /^(yes|true|1|y)$/i.test(v.trim());

/**
 * Columns this importer understands. `Title` is the address because that is
 * what the SharePoint list called it — but a file that also has an explicit
 * `Email` column means something else by `Title`, so the explicit one wins.
 * Getting that the wrong way round skips every row as "not an address".
 */
const EMAIL_HEADERS = ["Email", "EMail", "E-mail", "Address", "Title"];

export function parseStaffCsv(text: string): ParsedStaff {
  const all = parseCsv(text);
  const headerAt = all.findIndex((r) => !isBlank(r));
  if (headerAt === -1) throw new Error("The file is empty.");
  const header = all[headerAt]!;

  const index = (...names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const cols = {
    email: index(...EMAIL_HEADERS),
    name: index("OfficialName", "Official Name", "Name", "Full Name"),
    active: index("Active"),
    isAdmin: index("IsAdmin", "Is Admin", "Admin"),
    invoices: index("HasInvoices", "Invoices"),
    timesheet: index("HasTimesheet", "Timesheets", "Timesheet"),
    expenses: index("HasExpenses", "Expenses"),
  };

  if (cols.email === -1) {
    throw new Error(
      `No email column. Looked for ${EMAIL_HEADERS.join(", ")}; found: ${header.join(", ")}`,
    );
  }

  const warnings: string[] = [];

  // Margin, Tax Breakdown and My Profile arrived after this file's shape was
  // fixed. A "HasMargin" column in the export would be read by nobody, and
  // everyone would land without it, so say so rather than importing quietly.
  const mapped = new Set(Object.values(cols).filter((i) => i !== -1));
  header.forEach((h, i) => {
    if (mapped.has(i)) return;
    if (/^\s*has[\s_-]?\w+/i.test(h)) {
      warnings.push(
        `column "${h.trim()}" is not imported — grant it on the admin screen instead`,
      );
    }
  });

  const seen = new Set<string>();
  const rows: StaffRow[] = [];

  for (let i = headerAt + 1; i < all.length; i++) {
    const line = all[i]!;
    const at = `line ${i + 1}`;
    if (isBlank(line)) continue;

    const cell = (c: number) => (c === -1 ? "" : (line[c] ?? "").trim());
    const email = cell(cols.email).toLowerCase();

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

export type StaffSummary = {
  people: number;
  active: number;
  admins: number;
  invoices: number;
  timesheet: number;
  expenses: number;
  warnings: string[];
};

/**
 * What gets printed before anything is written. The counts are what --dry-run
 * shows; the warning is the one that matters, because a file with no active
 * admin in it locks the admin screen behind BOOTSTRAP_ADMINS.
 */
export function summariseStaff(rows: StaffRow[]): StaffSummary {
  const admins = rows.filter((r) => r.active && r.is_admin).length;
  return {
    people: rows.length,
    active: rows.filter((r) => r.active).length,
    admins,
    invoices: rows.filter((r) => r.has_invoices).length,
    timesheet: rows.filter((r) => r.has_timesheet).length,
    expenses: rows.filter((r) => r.has_expenses).length,
    warnings:
      admins === 0
        ? [
            "No active admin in this file. BOOTSTRAP_ADMINS is the way back in — check it is set before you rely on this.",
          ]
        : [],
  };
}

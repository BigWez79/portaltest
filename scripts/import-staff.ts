/**
 * One-off import of the staff list into Supabase.
 *
 *   npm run import:staff -- staff.csv --dry-run
 *   npm run import:staff -- staff.csv
 *
 * Reads a CSV rather than SharePoint, so this repository has no Microsoft
 * dependency at all. Export the Staff list from SharePoint to CSV in the browser
 * (Export → Export to CSV), then run this once. After that, the admin screen is
 * where access is granted and this script is history.
 *
 * Expected headers, case-insensitive, extra columns ignored:
 *
 *   Title | Email        the address (the SharePoint list used Title)
 *   OfficialName | Name  the person's name
 *   Active, IsAdmin, HasInvoices, HasTimesheet, HasExpenses
 *                        Yes / No / true / false / 1 / 0
 *
 * It does not send invitations. Import first, check the list on the admin
 * screen, then invite people from there when you are ready for them to arrive.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("Usage: npm run import:staff -- <staff.csv> [--dry-run]");
  process.exit(1);
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Minimal RFC-4180 reader: quoted fields, escaped quotes, embedded commas. */
function parseCsv(text: string): string[][] {
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

const truthy = (v: string) => /^(yes|true|1|y)$/i.test(v.trim());

type Row = {
  email: string;
  full_name: string | null;
  active: boolean;
  is_admin: boolean;
  has_invoices: boolean;
  has_timesheet: boolean;
  has_expenses: boolean;
};

function toRows(csv: string): Row[] {
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

  for (const [n, line] of body.entries()) {
    const cell = (i: number) => (i === -1 ? "" : (line[i] ?? "").trim());
    const email = cell(cols.email).toLowerCase();

    if (!email) {
      console.warn(`  line ${n + 2}: no address, skipped`);
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.warn(`  line ${n + 2}: "${email}" is not an address, skipped`);
      continue;
    }
    if (seen.has(email)) {
      console.warn(`  line ${n + 2}: ${email} appears twice, later one skipped`);
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

  return rows;
}

async function main() {
  const rows = toRows(readFileSync(file!, "utf8"));

  console.log(`Read ${rows.length} people from ${file}`);
  console.log(`  active:   ${rows.filter((r) => r.active).length}`);
  console.log(`  admins:   ${rows.filter((r) => r.active && r.is_admin).length}`);
  console.log(`  invoices: ${rows.filter((r) => r.has_invoices).length}`);
  console.log(`  timesheet:${rows.filter((r) => r.has_timesheet).length}`);
  console.log(`  expenses: ${rows.filter((r) => r.has_expenses).length}`);

  if (rows.filter((r) => r.active && r.is_admin).length === 0) {
    console.warn(
      "\nNo active admin in this file. BOOTSTRAP_ADMINS is the way back in — check it is set before you rely on this.",
    );
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const { error } = await supabase.from("staff").upsert(rows, { onConflict: "email" });
  if (error) throw new Error(`Import failed: ${error.message}`);

  console.log(`\nImported ${rows.length} people. Nobody has been emailed.`);
  console.log("Invite them from the admin screen when you are ready.");
}

main().catch((err: unknown) => {
  console.error("import failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

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
 *   Email | Title       the address (the SharePoint list used Title; an
 *                       explicit Email column wins if the file has both)
 *   OfficialName | Name  the person's name
 *   Active, IsAdmin, HasInvoices, HasTimesheet, HasExpenses
 *                        Yes / No / true / false / 1 / 0
 *
 * Margin and Tax Breakdown are not imported — they are granted on the admin
 * screen. A file carrying columns for them says so in the warnings.
 *
 * The parsing lives in `staff-csv.ts` and is covered by
 * `tests/staff-csv.spec.ts`. This file is what reads the disk and writes rows.
 *
 * It does not send invitations. Import first, check the list on the admin
 * screen, then invite people from there when you are ready for them to arrive.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseStaffCsv, summariseStaff } from "./staff-csv";

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

async function main() {
  const { rows, warnings } = parseStaffCsv(readFileSync(file!, "utf8"));
  for (const w of warnings) console.warn(`  ${w}`);

  const summary = summariseStaff(rows);
  console.log(`Read ${summary.people} people from ${file}`);
  console.log(`  active:   ${summary.active}`);
  console.log(`  admins:   ${summary.admins}`);
  console.log(`  invoices: ${summary.invoices}`);
  console.log(`  timesheet:${summary.timesheet}`);
  console.log(`  expenses: ${summary.expenses}`);
  for (const w of summary.warnings) console.warn(`\n${w}`);

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

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
 * The reading of the file lives in `scripts/staff-csv.ts`, where it is tested.
 * This half is the part that talks to Supabase.
 *
 * It does not send invitations. Import first, check the list on the admin
 * screen, then invite people from there when you are ready for them to arrive.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readStaffCsv } from "./staff-csv";

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
  const { rows, warnings, counts } = readStaffCsv(readFileSync(file!, "utf8"));

  console.log(`Read ${counts.people} people from ${file}`);
  console.log(`  active:   ${counts.active}`);
  console.log(`  admins:   ${counts.activeAdmins}`);
  console.log(`  invoices: ${counts.invoices}`);
  console.log(`  timesheet:${counts.timesheet}`);
  console.log(`  expenses: ${counts.expenses}`);

  if (warnings.length > 0) {
    console.warn(`\nCheck these before you rely on the import:`);
    for (const warning of warnings) console.warn(`  ${warning}`);
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

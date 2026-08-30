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
 * The reading is in `scripts/staff-csv.ts` and is covered by
 * `tests/staff-csv.spec.ts`; this file is argv, the file, the network and the
 * printing, none of which a test can pin at 3am.
 *
 * It does not send invitations. Import first, check the list on the admin
 * screen, then invite people from there when you are ready for them to arrive.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readStaffCsv, summarise } from "./staff-csv";

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
  const { rows, warnings, missingColumns } = readStaffCsv(readFileSync(file!, "utf8"));

  for (const warning of warnings) console.warn(`  ${warning}`);

  const counts = summarise(rows);
  console.log(`Read ${counts.people} people from ${file}`);
  console.log(`  active:   ${counts.active}`);
  console.log(`  admins:   ${counts.admins}`);
  console.log(`  invoices: ${counts.invoices}`);
  console.log(`  timesheet:${counts.timesheet}`);
  console.log(`  expenses: ${counts.expenses}`);

  if (missingColumns.length > 0) {
    const plural = missingColumns.length === 1 ? "column" : "columns";
    console.warn(
      `\nThis file has no ${missingColumns.join(", ")} ${plural}. Those counts read 0 because the column was not found, not because nobody has the app. Check the export before writing anything.`,
    );
  }

  if (counts.noActiveAdmin) {
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

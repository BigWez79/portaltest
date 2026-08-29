import { expect, test } from "@playwright/test";
import { parseStaffCsv, summariseStaff, truthy } from "../scripts/staff-csv";

/**
 * The one-off staff import (TASKS.md P0).
 *
 * `scripts/import-staff.ts` runs once, against production, and sets the access
 * flags for every member of staff. Its failure mode is the quiet one: a
 * mis-read column does not crash, it grants the wrong people the wrong apps,
 * and --dry-run prints counts rather than rows so nothing looks wrong. So the
 * mapping is pinned here rather than trusted.
 *
 * These tests touch no browser, no file and no Supabase project: they call
 * `scripts/staff-csv.ts`, which imports none of those.
 */

const HEADER = "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses";

const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

test("Title is the address, and Yes is the only thing that grants", () => {
  const { rows, warnings } = parseStaffCsv(
    csv(
      "ada@example.com,Ada Lovelace,Yes,Yes,Yes,No,",
      "grace@example.com,Grace Hopper,Yes,No,No,Yes,Yes",
    ),
  );

  expect(warnings).toEqual([]);
  expect(rows).toEqual([
    {
      email: "ada@example.com",
      full_name: "Ada Lovelace",
      active: true,
      is_admin: true,
      has_invoices: true,
      has_timesheet: false,
      has_expenses: false,
    },
    {
      email: "grace@example.com",
      full_name: "Grace Hopper",
      active: true,
      is_admin: false,
      has_invoices: false,
      has_timesheet: true,
      has_expenses: true,
    },
  ]);
});

test("an address is lower-cased and trimmed; a missing name is null", () => {
  const { rows } = parseStaffCsv(csv("  ADA@Example.COM ,,Yes,No,No,No,No"));

  expect(rows).toHaveLength(1);
  expect(rows[0]!.email).toBe("ada@example.com");
  expect(rows[0]!.full_name).toBeNull();
});

test("truthy accepts the shapes a spreadsheet produces, and nothing else", () => {
  for (const yes of ["Yes", "yes", "YES", "true", "TRUE", "1", "y", " Yes "]) {
    expect(truthy(yes), `${yes} should grant`).toBe(true);
  }
  for (const no of ["No", "no", "false", "0", "", "  ", "N/A", "yes please", "-1", "2"]) {
    expect(truthy(no), `${no} should not grant`).toBe(false);
  }
});

test("a quoted field may contain a comma, a quote and a newline", () => {
  const { rows } = parseStaffCsv(
    csv(
      '"ada@example.com","Lovelace, Ada",Yes,No,Yes,No,No',
      '"grace@example.com","Grace ""Amazing"" Hopper",Yes,No,No,No,No',
      '"alan@example.com","Turing\nAlan",Yes,No,No,No,No',
    ),
  );

  expect(rows.map((r) => r.full_name)).toEqual([
    "Lovelace, Ada",
    'Grace "Amazing" Hopper',
    "Turing\nAlan",
  ]);
  // The comma inside the quotes must not have shifted the flags along a column.
  expect(rows[0]!.has_invoices).toBe(true);
  expect(rows[0]!.has_timesheet).toBe(false);
});

test("a duplicate address keeps the first row and warns about the second", () => {
  const { rows, warnings } = parseStaffCsv(
    csv(
      "ada@example.com,Ada Lovelace,Yes,Yes,Yes,No,No",
      "ADA@example.com,Ada Again,No,No,No,Yes,Yes",
    ),
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]!.is_admin).toBe(true);
  expect(rows[0]!.has_expenses).toBe(false);
  expect(warnings).toEqual(["line 3: ada@example.com appears twice, later one skipped"]);
});

test("a row with no address is skipped and named by its line number", () => {
  const { rows, warnings } = parseStaffCsv(
    csv(
      "ada@example.com,Ada Lovelace,Yes,Yes,No,No,No",
      ",Nobody At All,Yes,Yes,Yes,Yes,Yes",
      "grace@example.com,Grace Hopper,Yes,No,No,No,No",
    ),
  );

  expect(rows.map((r) => r.email)).toEqual(["ada@example.com", "grace@example.com"]);
  expect(warnings).toEqual(["line 3: no address, skipped"]);
});

test("something that is not an address is skipped rather than imported", () => {
  const { rows, warnings } = parseStaffCsv(
    csv("Director,Someone,Yes,Yes,Yes,Yes,Yes", "ada@example.com,Ada,Yes,No,No,No,No"),
  );

  expect(rows.map((r) => r.email)).toEqual(["ada@example.com"]);
  expect(warnings).toEqual(['line 2: "director" is not an address, skipped']);
});

test("a blank line does not shift the line numbers in the warnings", () => {
  const { rows, warnings } = parseStaffCsv(
    csv("ada@example.com,Ada,Yes,Yes,No,No,No", "", ",Nobody,Yes,No,No,No,No"),
  );

  expect(rows).toHaveLength(1);
  expect(warnings).toEqual(["line 4: no address, skipped"]);
});

test("a file exported with a byte order mark still finds its columns", () => {
  const { rows } = parseStaffCsv("\uFEFF" + csv("ada@example.com,Ada,Yes,Yes,No,No,No"));

  expect(rows).toHaveLength(1);
  expect(rows[0]!.email).toBe("ada@example.com");
});

test("carriage returns from a Windows export are not part of a field", () => {
  const { rows } = parseStaffCsv(
    csv("ada@example.com,Ada,Yes,Yes,No,No,No").replace(/\n/g, "\r\n") + "\r\n",
  );

  expect(rows).toEqual([
    {
      email: "ada@example.com",
      full_name: "Ada",
      active: true,
      is_admin: true,
      has_invoices: false,
      has_timesheet: false,
      has_expenses: false,
    },
  ]);
});

test("an explicit Email column wins over a Title that means a job title", () => {
  const { rows } = parseStaffCsv(
    [
      "Title,Email,Name,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses",
      "Director,ada@example.com,Ada,Yes,Yes,No,No,No",
    ].join("\n"),
  );

  expect(rows.map((r) => r.email)).toEqual(["ada@example.com"]);
  expect(rows[0]!.full_name).toBe("Ada");
});

test("a file with no email column at all is refused, loudly", () => {
  expect(() => parseStaffCsv("Name,Active\nAda,Yes")).toThrow(/No email column/);
  expect(() => parseStaffCsv("")).toThrow(/empty/);
  expect(() => parseStaffCsv("\n \n")).toThrow(/empty/);
});

test("an access column this importer does not know about is called out", () => {
  const { rows, warnings } = parseStaffCsv(
    [
      HEADER + ",HasMargin,Has Tax Breakdown",
      "ada@example.com,Ada,Yes,Yes,No,No,No,Yes,Yes",
    ].join("\n"),
  );

  expect(warnings).toEqual([
    'column "HasMargin" is not imported — grant it on the admin screen instead',
    'column "Has Tax Breakdown" is not imported — grant it on the admin screen instead',
  ]);
  // Warned about, not smuggled into the row: those two are admin-screen grants.
  expect(Object.keys(rows[0]!)).not.toContain("has_margin");
});

test("a file with no active admin in it warns; one with an admin does not", () => {
  const none = summariseStaff(
    parseStaffCsv(
      csv(
        "ada@example.com,Ada,Yes,No,Yes,No,No",
        // An admin who is not active is not a way back in.
        "grace@example.com,Grace,No,Yes,No,No,No",
      ),
    ).rows,
  );

  expect(none.admins).toBe(0);
  expect(none.warnings).toHaveLength(1);
  expect(none.warnings[0]).toContain("No active admin in this file");
  expect(none.warnings[0]).toContain("BOOTSTRAP_ADMINS");

  const some = summariseStaff(
    parseStaffCsv(csv("ada@example.com,Ada,Yes,Yes,No,No,No")).rows,
  );
  expect(some.admins).toBe(1);
  expect(some.warnings).toEqual([]);
});

test("the counts --dry-run prints are the counts of what would be written", () => {
  const { rows } = parseStaffCsv(
    csv(
      "ada@example.com,Ada,Yes,Yes,Yes,Yes,No",
      "grace@example.com,Grace,Yes,No,Yes,No,No",
      "alan@example.com,Alan,No,No,No,No,Yes",
    ),
  );

  expect(summariseStaff(rows)).toEqual({
    people: 3,
    active: 2,
    admins: 1,
    invoices: 2,
    timesheet: 1,
    expenses: 1,
    warnings: [],
  });
});

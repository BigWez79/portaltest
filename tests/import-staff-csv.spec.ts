import { expect, test } from "@playwright/test";
import { parseCsv, summarise, toRows, truthy } from "../scripts/staff-csv";

/**
 * The CSV parser behind `scripts/import-staff.ts`.
 *
 * That script runs once, against production, and sets the access flags for
 * every member of staff. A mis-parsed column does not crash — it grants the
 * wrong people the wrong apps, and `--dry-run` prints counts rather than rows,
 * so nothing about the run would look wrong. These tests are what stands
 * between a shifted column and that.
 *
 * No browser and no Supabase connection: this imports a pure module and calls
 * it, so it runs anywhere the rest of the suite does and needs nothing running.
 * It uses `@playwright/test` directly rather than `./harness` because the
 * harness's fixtures are about a page, and there is no page here.
 */

/** The shape SharePoint's "Export to CSV" produces for the Staff list. */
const SHAREPOINT = [
  "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses",
  "Ada@Example.com,Ada Lovelace,Yes,Yes,Yes,Yes,Yes",
  "grace@example.com,Grace Hopper,Yes,No,Yes,No,No",
  "alan@example.com,Alan Turing,No,No,No,No,No",
].join("\n");

test.describe("column mapping", () => {
  test("Title is the address, and OfficialName the name", () => {
    const { rows, warnings } = toRows(SHAREPOINT);

    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      email: "ada@example.com",
      full_name: "Ada Lovelace",
      active: true,
      is_admin: true,
      has_invoices: true,
      has_timesheet: true,
      has_expenses: true,
    });
    expect(rows[1]).toMatchObject({
      email: "grace@example.com",
      full_name: "Grace Hopper",
      active: true,
      is_admin: false,
      has_invoices: true,
      has_timesheet: false,
      has_expenses: false,
    });
  });

  test("an address is lower-cased, so the same person is one row", () => {
    expect(toRows(SHAREPOINT).rows[0]!.email).toBe("ada@example.com");
  });

  test("the alternative headers are accepted, in any case, with extra columns ignored", () => {
    const { rows } = toRows(
      [
        "Department,email,Full Name,ACTIVE,Admin,Invoices,Timesheets,Expenses,Modified",
        "Finance,bea@example.com,Bea,yes,no,yes,yes,no,2026-08-01",
      ].join("\n"),
    );

    expect(rows).toEqual([
      {
        email: "bea@example.com",
        full_name: "Bea",
        active: true,
        is_admin: false,
        has_invoices: true,
        has_timesheet: true,
        has_expenses: false,
      },
    ]);
  });

  test("a column that is not in the file reads as false, not as missing", () => {
    const { rows } = toRows(["Title,Active", "cass@example.com,Yes"].join("\n"));

    expect(rows[0]).toEqual({
      email: "cass@example.com",
      full_name: null,
      active: true,
      is_admin: false,
      has_invoices: false,
      has_timesheet: false,
      has_expenses: false,
    });
  });

  test("a file with no address column is refused rather than half-read", () => {
    expect(() => toRows(["Department,Active", "Finance,Yes"].join("\n"))).toThrow(
      /No email column/,
    );
  });

  test("an empty file is refused", () => {
    expect(() => toRows("")).toThrow(/empty/);
    expect(() => toRows("\n\n")).toThrow(/empty/);
  });
});

test.describe("Yes means true, and nothing else does", () => {
  for (const yes of ["Yes", "yes", "YES", "y", "true", "TRUE", "1", " Yes "]) {
    test(`"${yes}" is true`, () => expect(truthy(yes)).toBe(true));
  }

  // "0", "No" and "" are the file's way of saying no. Anything unrecognised is
  // also no: the safe direction for an access flag is off.
  for (const no of ["No", "no", "N", "0", "false", "", "  ", "Yes please", "TRUE-ish", "2"]) {
    test(`"${no}" is false`, () => expect(truthy(no)).toBe(false));
  }

  test("the flags land on the columns they were written in", () => {
    const { rows } = toRows(
      [
        "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses",
        "dee@example.com,Dee,Yes,No,No,Yes,No",
      ].join("\n"),
    );

    expect(rows[0]).toMatchObject({
      active: true,
      is_admin: false,
      has_invoices: false,
      has_timesheet: true,
      has_expenses: false,
    });
  });
});

test.describe("quoting", () => {
  test("a quoted field may contain a comma without shifting every flag along one", () => {
    const { rows } = toRows(
      [
        "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses",
        '"eve@example.com","Hopper, Grace B.",Yes,Yes,No,No,Yes',
      ].join("\n"),
    );

    expect(rows[0]).toEqual({
      email: "eve@example.com",
      full_name: "Hopper, Grace B.",
      active: true,
      is_admin: true,
      has_invoices: false,
      has_timesheet: false,
      has_expenses: true,
    });
  });

  test("a doubled quote is one quote, and a newline inside quotes does not end the row", () => {
    const rows = parseCsv('a,"say ""hi""","two\nlines"\n');

    expect(rows).toEqual([["a", 'say "hi"', "two\nlines"]]);
  });

  test("CRLF line endings, and a file with no trailing newline, read the same", () => {
    const withCrlf = toRows(SHAREPOINT.replace(/\n/g, "\r\n"));
    const withTrailing = toRows(`${SHAREPOINT}\n`);

    expect(withCrlf.rows).toEqual(toRows(SHAREPOINT).rows);
    expect(withTrailing.rows).toEqual(toRows(SHAREPOINT).rows);
  });

  test("blank lines between rows are not people", () => {
    const { rows, warnings } = toRows(
      ["Title,Active", "fay@example.com,Yes", "", "   ", "gus@example.com,No"].join("\n"),
    );

    expect(rows.map((r) => r.email)).toEqual(["fay@example.com", "gus@example.com"]);
    expect(warnings).toEqual([]);
  });
});

test.describe("rows that are skipped, and say so", () => {
  test("a row with no address is skipped and named by line number", () => {
    const { rows, warnings } = toRows(
      [
        "Title,OfficialName,Active,IsAdmin",
        "hal@example.com,Hal,Yes,Yes",
        ",Nobody,Yes,Yes",
        "ivy@example.com,Ivy,Yes,No",
      ].join("\n"),
    );

    expect(rows.map((r) => r.email)).toEqual(["hal@example.com", "ivy@example.com"]);
    expect(warnings).toEqual(["line 3: no address, skipped"]);
  });

  test("something that is not an address is skipped rather than imported", () => {
    const { rows, warnings } = toRows(
      ["Title,Active", "Not An Address,Yes", "jo@example.com,Yes"].join("\n"),
    );

    expect(rows.map((r) => r.email)).toEqual(["jo@example.com"]);
    expect(warnings).toEqual(['line 2: "not an address" is not an address, skipped']);
  });

  test("a duplicate address keeps the first row, not the last", () => {
    const { rows, warnings } = toRows(
      [
        "Title,OfficialName,Active,IsAdmin,HasInvoices",
        "kim@example.com,Kim,Yes,Yes,Yes",
        "KIM@example.com,Kim again,No,No,No",
      ].join("\n"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      full_name: "Kim",
      active: true,
      is_admin: true,
      has_invoices: true,
    });
    expect(warnings).toEqual(["line 3: kim@example.com appears twice, later one skipped"]);
  });

  test("a short row is padded with falses rather than reading the next row's cells", () => {
    const { rows, warnings } = toRows(
      [
        "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses",
        "lee@example.com,Lee,Yes",
        "mo@example.com,Mo,Yes,Yes,Yes,Yes,Yes",
      ].join("\n"),
    );

    expect(warnings).toEqual([]);
    expect(rows[0]).toMatchObject({ email: "lee@example.com", active: true, is_admin: false });
    expect(rows[1]).toMatchObject({ email: "mo@example.com", is_admin: true });
  });
});

test.describe("the counts the run is judged by", () => {
  test("they count what was imported, and admins means active admins", () => {
    const { rows } = toRows(SHAREPOINT);
    const counts = summarise(rows);

    expect(counts).toEqual({
      total: 3,
      active: 2,
      admins: 1,
      invoices: 2,
      timesheet: 1,
      expenses: 1,
      noActiveAdmin: false,
    });
  });

  test("a file with no active admin is flagged — BOOTSTRAP_ADMINS is then the only way in", () => {
    const { rows } = toRows(
      [
        "Title,OfficialName,Active,IsAdmin",
        "nan@example.com,Nan,Yes,No",
        "oli@example.com,Oli,Yes,No",
      ].join("\n"),
    );

    expect(summarise(rows).noActiveAdmin).toBe(true);
  });

  test("an admin who is not active does not count as a way back in", () => {
    const { rows } = toRows(
      ["Title,OfficialName,Active,IsAdmin", "pat@example.com,Pat,No,Yes"].join("\n"),
    );

    expect(summarise(rows).admins).toBe(0);
    expect(summarise(rows).noActiveAdmin).toBe(true);
  });

  test("one active admin is enough", () => {
    const { rows } = toRows(
      [
        "Title,OfficialName,Active,IsAdmin",
        "pat@example.com,Pat,No,Yes",
        "quinn@example.com,Quinn,Yes,Yes",
      ].join("\n"),
    );

    expect(summarise(rows).noActiveAdmin).toBe(false);
  });

  test("an empty file of people is flagged too", () => {
    expect(summarise([]).noActiveAdmin).toBe(true);
  });
});

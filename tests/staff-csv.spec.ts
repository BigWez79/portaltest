import { expect, test } from "@playwright/test";
import { parseCsv, summarise, toRows, truthy } from "../scripts/staff-csv";

/**
 * The CSV parser behind the one-off staff import.
 *
 * This is the only code in the project that runs once, against production, and
 * sets the access flags for every member of staff. It fails quietly: a column
 * read off by one does not crash, it grants the wrong people the wrong apps,
 * and `--dry-run` prints counts rather than rows, so nothing looks wrong.
 *
 * So the mapping is pinned here rather than checked by eye. These tests take
 * strings and return values — no browser, no Supabase, no file on disk — which
 * is why they use Playwright's own `test` rather than ./harness: there is no
 * page to watch for console errors.
 */

const HEADER =
  "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses";

test.describe("the CSV reader", () => {
  test("splits plain fields and keeps the line numbers", () => {
    const rows = parseCsv("a,b\nc,d\n");
    expect(rows).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["c", "d"] },
    ]);
  });

  test("keeps a comma inside a quoted field", () => {
    const rows = parseCsv('one,"Smith, Jane",three\n');
    expect(rows[0]?.cells).toEqual(["one", "Smith, Jane", "three"]);
  });

  test("unescapes a doubled quote, and keeps a newline inside quotes", () => {
    const rows = parseCsv('"say ""hello""","two\nlines"\nnext,row\n');
    expect(rows[0]?.cells).toEqual(['say "hello"', "two\nlines"]);
    // The quoted newline is part of the field, so the next row starts at line 3.
    expect(rows[1]).toEqual({ line: 3, cells: ["next", "row"] });
  });

  test("reads CRLF and a file with no trailing newline", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["c", "d"] },
    ]);
  });

  test("drops the byte-order mark SharePoint's export writes", () => {
    const rows = toRows(`\uFEFF${HEADER}\nwes@example.com,Wes,Yes,Yes,,,\n`).rows;
    expect(rows.map((r) => r.email)).toEqual(["wes@example.com"]);
  });
});

test.describe("the column mapping", () => {
  test("Title is the address and OfficialName is the name", () => {
    const { rows, warnings } = toRows(
      `${HEADER}\nWes@Example.com,Wesley Hughes,Yes,Yes,Yes,No,No\n`,
    );

    expect(warnings).toEqual([]);
    expect(rows).toEqual([
      {
        email: "wes@example.com",
        full_name: "Wesley Hughes",
        active: true,
        is_admin: true,
        has_invoices: true,
        has_timesheet: false,
        has_expenses: false,
      },
    ]);
  });

  test("headers match whatever their case and spacing, and extra columns are ignored", () => {
    const { rows } = toRows(
      "Department, email , Full Name ,ACTIVE,Is Admin,Invoices,Timesheets,Expenses,Modified\n" +
        "Ops,ann@example.com,Ann,yes,no,1,true,y,2026-01-01\n",
    );

    expect(rows).toEqual([
      {
        email: "ann@example.com",
        full_name: "Ann",
        active: true,
        is_admin: false,
        has_invoices: true,
        has_timesheet: true,
        has_expenses: true,
      },
    ]);
  });

  test("Title wins over Email when a file has both", () => {
    const { rows } = toRows("Email,Title\nother@example.com,first@example.com\n");
    expect(rows.map((r) => r.email)).toEqual(["first@example.com"]);
  });

  test("a missing flag column reads as false, not as true", () => {
    const { rows } = toRows("Title,Active\nann@example.com,Yes\n");
    expect(rows[0]).toMatchObject({
      active: true,
      is_admin: false,
      has_invoices: false,
      has_timesheet: false,
      has_expenses: false,
    });
  });

  test("an empty name column becomes null rather than an empty string", () => {
    const { rows } = toRows(`${HEADER}\nann@example.com, ,Yes,No,No,No,No\n`);
    expect(rows[0]?.full_name).toBeNull();
  });

  test("a quoted name containing a comma does not shift the flags along", () => {
    const { rows } = toRows(
      `${HEADER}\nann@example.com,"Hughes, Ann",Yes,No,Yes,No,No\n`,
    );
    expect(rows[0]).toMatchObject({
      full_name: "Hughes, Ann",
      active: true,
      is_admin: false,
      has_invoices: true,
      has_timesheet: false,
      has_expenses: false,
    });
  });

  test("a file with no address column is refused, not half-imported", () => {
    expect(() => toRows("Department,Active\nOps,Yes\n")).toThrow(/No email column/);
  });

  test("an empty file is refused", () => {
    expect(() => toRows("")).toThrow(/empty/);
  });
});

test.describe("what counts as Yes", () => {
  for (const yes of ["Yes", "yes", "YES", "y", "true", "TRUE", "1", " Yes "]) {
    test(`"${yes}" is true`, () => expect(truthy(yes)).toBe(true));
  }

  for (const no of ["No", "n", "false", "0", "", "  ", "Yes please", "-1", "2"]) {
    test(`"${no}" is false`, () => expect(truthy(no)).toBe(false));
  }
});

test.describe("rows the parser refuses", () => {
  test("a row with no address is skipped and named by its line", () => {
    const { rows, warnings } = toRows(
      `${HEADER}\n` +
        "ann@example.com,Ann,Yes,No,No,No,No\n" +
        ",Nobody,Yes,Yes,Yes,Yes,Yes\n" +
        "bob@example.com,Bob,Yes,No,No,No,No\n",
    );

    expect(rows.map((r) => r.email)).toEqual(["ann@example.com", "bob@example.com"]);
    expect(warnings).toEqual(["line 3: no address, skipped"]);
  });

  test("something that is not an address is skipped rather than imported", () => {
    const { rows, warnings } = toRows(`${HEADER}\nWesley Hughes,Wes,Yes,Yes,,,\n`);

    expect(rows).toEqual([]);
    expect(warnings).toEqual([`line 2: "wesley hughes" is not an address, skipped`]);
  });

  test("a duplicate address keeps the first row and skips the later one", () => {
    const { rows, warnings } = toRows(
      `${HEADER}\n` +
        "ann@example.com,Ann,Yes,Yes,Yes,Yes,Yes\n" +
        "ANN@example.com,Ann Again,No,No,No,No,No\n",
    );

    // The first row's flags survive — a later duplicate must not quietly
    // deactivate somebody or take their apps away.
    expect(rows).toEqual([
      {
        email: "ann@example.com",
        full_name: "Ann",
        active: true,
        is_admin: true,
        has_invoices: true,
        has_timesheet: true,
        has_expenses: true,
      },
    ]);
    expect(warnings).toEqual([
      "line 3: ann@example.com appears twice, later one skipped",
    ]);
  });

  test("a blank line is passed over without a warning, and does not move the numbering", () => {
    const { rows, warnings } = toRows(
      `${HEADER}\n` +
        "\n" +
        "ann@example.com,Ann,Yes,No,No,No,No\n" +
        ",Nobody,Yes,No,No,No,No\n",
    );

    expect(rows.map((r) => r.email)).toEqual(["ann@example.com"]);
    expect(warnings).toEqual(["line 4: no address, skipped"]);
  });
});

test.describe("the summary", () => {
  const FILE =
    `${HEADER}\n` +
    "ann@example.com,Ann,Yes,Yes,Yes,Yes,No\n" +
    "bob@example.com,Bob,Yes,No,Yes,No,Yes\n" +
    "old@example.com,Old,No,Yes,Yes,Yes,Yes\n";

  test("counts people, not lines", () => {
    const counts = summarise(toRows(FILE).rows);
    expect(counts).toEqual({
      total: 3,
      active: 2,
      admins: 1,
      invoices: 3,
      timesheet: 2,
      expenses: 2,
      noActiveAdmin: false,
    });
  });

  test("an inactive admin does not count as an admin", () => {
    const counts = summarise(
      toRows(`${HEADER}\nold@example.com,Old,No,Yes,No,No,No\n`).rows,
    );
    expect(counts.admins).toBe(0);
    expect(counts.noActiveAdmin).toBe(true);
  });

  test("a file with no active admin is flagged — that import locks everybody out", () => {
    const counts = summarise(
      toRows(
        `${HEADER}\n` +
          "ann@example.com,Ann,Yes,No,Yes,Yes,Yes\n" +
          "bob@example.com,Bob,Yes,No,Yes,Yes,Yes\n",
      ).rows,
    );

    expect(counts.active).toBe(2);
    expect(counts.noActiveAdmin).toBe(true);
  });

  test("an empty list is flagged too", () => {
    expect(summarise([]).noActiveAdmin).toBe(true);
  });
});

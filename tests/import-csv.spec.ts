import { expect, test } from "@playwright/test";

import {
  NO_ACTIVE_ADMIN_WARNING,
  parseCsv,
  summarise,
  toRows,
  truthy,
} from "../scripts/staff-csv";

/**
 * The one-off staff import runs once, against production, and sets the access
 * flags for everybody. Its failure mode is quiet: a mis-parsed column does not
 * crash, it grants the wrong people the wrong apps, and --dry-run prints counts
 * rather than rows so nothing looks wrong.
 *
 * These tests pin the mapping. They touch no file, no environment variable and
 * no Supabase project — `scripts/staff-csv.ts` imports none of those.
 */

const HEADER = "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses";

/** A file the import would be happy with: one active admin, one active user. */
const GOOD_FILE = [
  HEADER,
  "anna@poweranalytix.co.uk,Anna Adams,Yes,Yes,Yes,Yes,Yes",
  "ben@poweranalytix.co.uk,Ben Brown,Yes,No,Yes,No,No",
].join("\n");

test.describe("the columns a row is read from", () => {
  test("Title is the address, OfficialName is the name", () => {
    const { rows, warnings } = toRows(GOOD_FILE);

    expect(warnings).toEqual([]);
    expect(rows).toEqual([
      {
        email: "anna@poweranalytix.co.uk",
        full_name: "Anna Adams",
        active: true,
        is_admin: true,
        has_invoices: true,
        has_timesheet: true,
        has_expenses: true,
      },
      {
        email: "ben@poweranalytix.co.uk",
        full_name: "Ben Brown",
        active: true,
        is_admin: false,
        has_invoices: true,
        has_timesheet: false,
        has_expenses: false,
      },
    ]);
  });

  test("Email and Address stand in for Title, and headers are case-insensitive", () => {
    const { rows } = toRows("email,NAME,active\nCarl@Example.com,Carl,yes");

    expect(rows[0]?.email).toBe("carl@example.com");
    expect(rows[0]?.full_name).toBe("Carl");
    expect(rows[0]?.active).toBe(true);
  });

  test("Title wins when a file has both Title and Email", () => {
    const { rows } = toRows("Email,Title\nwrong@example.com,right@example.com");

    expect(rows[0]?.email).toBe("right@example.com");
  });

  test("a file with no address column is refused rather than half-imported", () => {
    expect(() => toRows("Person,Active\nanna@example.com,Yes")).toThrow(/No email column/);
  });

  test("an empty file is refused", () => {
    expect(() => toRows("")).toThrow(/empty/i);
  });

  test("columns this parser does not know are ignored", () => {
    // has_margin and has_tax_breakdown exist on the staff table but have no
    // mapping here — the SharePoint header for them has not been seen yet, so
    // an import leaves both at the column default and a person grants them on
    // the admin screen. If a mapping is added, this expectation changes.
    const { rows } = toRows(
      `${HEADER},HasMargin,HasTaxBreakdown,Department\n` +
        "dee@example.com,Dee,Yes,No,No,No,No,Yes,Yes,Finance",
    );

    expect(rows[0]).not.toHaveProperty("has_margin");
    expect(rows[0]).not.toHaveProperty("has_tax_breakdown");
    expect(rows[0]?.email).toBe("dee@example.com");
  });

  test("a name column that is absent or blank lands as null, not an empty string", () => {
    const { rows } = toRows("Title,OfficialName\nanna@example.com,\nben@example.com,  ");

    expect(rows.map((r) => r.full_name)).toEqual([null, null]);
  });
});

test.describe("Yes means true, and nothing else does by accident", () => {
  for (const yes of ["Yes", "yes", "YES", "true", "TRUE", "1", "y", " Yes "]) {
    test(`"${yes}" grants access`, () => {
      expect(truthy(yes)).toBe(true);
    });
  }

  for (const no of ["No", "no", "false", "0", "", "  ", "N/A", "yes please", "-", "2"]) {
    test(`"${no}" does not`, () => {
      expect(truthy(no)).toBe(false);
    });
  }

  test("a blank flag column is false, not undefined", () => {
    const { rows } = toRows(`${HEADER}\nanna@example.com,Anna,Yes,,,,`);

    expect(rows[0]).toMatchObject({
      active: true,
      is_admin: false,
      has_invoices: false,
      has_timesheet: false,
      has_expenses: false,
    });
  });

  test("a short row — trailing columns missing entirely — is false, not a crash", () => {
    const { rows } = toRows(`${HEADER}\nanna@example.com,Anna,Yes`);

    expect(rows[0]).toMatchObject({ active: true, has_expenses: false });
  });
});

test.describe("quoting", () => {
  test("a quoted field may contain a comma without shifting every column after it", () => {
    const { rows } = toRows(`${HEADER}\nanna@example.com,"Adams, Anna",Yes,Yes,No,No,No`);

    expect(rows[0]?.full_name).toBe("Adams, Anna");
    expect(rows[0]?.is_admin).toBe(true);
    expect(rows[0]?.has_invoices).toBe(false);
  });

  test("a doubled quote is one quote, and a quoted flag still reads as Yes", () => {
    const { rows } = toRows(`${HEADER}\nanna@example.com,"Anna ""Ann"" Adams","Yes","Yes",No,No,No`);

    expect(rows[0]?.full_name).toBe('Anna "Ann" Adams');
    expect(rows[0]?.active).toBe(true);
    expect(rows[0]?.is_admin).toBe(true);
  });

  test("a newline inside a quoted field does not split the row", () => {
    const rows = parseCsv('Title,OfficialName\nanna@example.com,"Anna\nAdams"');

    expect(rows).toHaveLength(2);
    expect(rows[1]?.cells[1]).toBe("Anna\nAdams");
  });

  test("CRLF line endings do not leave a stray carriage return on the last column", () => {
    const { rows } = toRows(`${HEADER}\r\nanna@example.com,Anna,Yes,No,No,No,Yes\r\n`);

    expect(rows[0]?.has_expenses).toBe(true);
    expect(rows).toHaveLength(1);
  });

  test("the BOM SharePoint's export writes does not hide the Title column", () => {
    const { rows } = toRows(`\uFEFF${GOOD_FILE}`);

    expect(rows[0]?.email).toBe("anna@poweranalytix.co.uk");
  });

  test("blank lines and a trailing newline do not become people", () => {
    const { rows, warnings } = toRows(`${GOOD_FILE}\n\n,,,,,,\n`);

    expect(rows).toHaveLength(2);
    expect(warnings).toEqual([]);
  });
});

test.describe("rows that are not imported say so", () => {
  test("a row with no address is skipped and named by line", () => {
    const { rows, warnings } = toRows(
      `${HEADER}\n,Nobody,Yes,Yes,Yes,Yes,Yes\nben@example.com,Ben,Yes,No,No,No,No`,
    );

    expect(rows.map((r) => r.email)).toEqual(["ben@example.com"]);
    expect(warnings).toEqual(["line 2: no address, skipped"]);
  });

  test("something that is not an address is skipped rather than imported", () => {
    const { rows, warnings } = toRows(`${HEADER}\nAnna Adams,Anna,Yes,Yes,Yes,Yes,Yes`);

    expect(rows).toEqual([]);
    expect(warnings).toEqual(['line 2: "anna adams" is not an address, skipped']);
  });

  test("a duplicate address keeps the first row and warns about the second", () => {
    const { rows, warnings } = toRows(
      `${HEADER}\n` +
        "anna@example.com,Anna,Yes,No,Yes,No,No\n" +
        "ben@example.com,Ben,Yes,No,No,No,No\n" +
        "Anna@Example.com,Anna Again,Yes,Yes,No,No,No",
    );

    expect(rows.map((r) => r.email)).toEqual(["anna@example.com", "ben@example.com"]);
    // The first row's flags survive; the later row's admin grant does not.
    expect(rows[0]).toMatchObject({ is_admin: false, has_invoices: true });
    expect(warnings).toEqual(["line 4: anna@example.com appears twice, later one skipped"]);
  });

  test("a warning names the line it came from even after a blank line and a wrapped field", () => {
    const { warnings } = toRows(
      `${HEADER}\n` +
        '\nanna@example.com,"Adams,\nAnna",Yes,Yes,No,No,No\n' +
        ",Nobody,Yes,Yes,Yes,Yes,Yes",
    );

    expect(warnings).toEqual(["line 5: no address, skipped"]);
  });
});

test.describe("the counts printed before anything is written", () => {
  test("a file with an active admin does not raise the warning", () => {
    const summary = summarise(toRows(GOOD_FILE).rows);

    expect(summary).toEqual({
      total: 2,
      active: 2,
      admins: 1,
      invoices: 2,
      timesheet: 1,
      expenses: 1,
      noActiveAdmin: false,
    });
  });

  test("a file with no admin at all raises the warning", () => {
    const summary = summarise(
      toRows(`${HEADER}\nben@example.com,Ben,Yes,No,Yes,No,No`).rows,
    );

    expect(summary.noActiveAdmin).toBe(true);
    expect(NO_ACTIVE_ADMIN_WARNING).toContain("BOOTSTRAP_ADMINS");
  });

  test("an admin who is not active does not count as a way back in", () => {
    const summary = summarise(
      toRows(`${HEADER}\nanna@example.com,Anna,No,Yes,No,No,No`).rows,
    );

    expect(summary.admins).toBe(0);
    expect(summary.active).toBe(0);
    expect(summary.noActiveAdmin).toBe(true);
  });

  test("an empty file of people — every row skipped — raises the warning too", () => {
    const summary = summarise(toRows(`${HEADER}\n,Nobody,Yes,Yes,Yes,Yes,Yes`).rows);

    expect(summary.total).toBe(0);
    expect(summary.noActiveAdmin).toBe(true);
  });
});

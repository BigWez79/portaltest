import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { parseCsv, readStaffCsv, summarise } from "../scripts/staff-csv";

/**
 * The one-off staff import reads a CSV by hand, runs once, against production,
 * and sets the access flags for every member of staff. A mis-parsed column does
 * not crash — it grants the wrong people the wrong apps, and `--dry-run` prints
 * counts rather than rows, so nothing looks wrong. These pin the mapping.
 *
 * Text in, rows out: no browser, no Supabase, no filesystem. They use
 * `@playwright/test` directly rather than `./harness`, because the harness's
 * page fixture is about a page and there is no page here.
 */

const HEADER = "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses";

test.describe("the header", () => {
  test("Title is the address, as the SharePoint list had it", () => {
    const { rows } = readStaffCsv(`${HEADER}\nsam@example.com,Sam Reed,Yes,No,Yes,No,No\n`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      email: "sam@example.com",
      full_name: "Sam Reed",
      active: true,
      is_admin: false,
      has_invoices: true,
      has_timesheet: false,
      has_expenses: false,
    });
  });

  test("Email and Address are accepted instead, and case does not matter", () => {
    for (const name of ["Email", "ADDRESS", "title"]) {
      const { rows } = readStaffCsv(`${name},Name\nsam@example.com,Sam\n`);
      expect(rows[0]?.email, `${name} should be read as the address`).toBe(
        "sam@example.com",
      );
    }
  });

  test("extra columns are ignored and order is not assumed", () => {
    const { rows, missingColumns } = readStaffCsv(
      "Department,HasExpenses,Notes,Title,IsAdmin,Active,HasInvoices,HasTimesheet\n" +
        "Ops,Yes,anything at all,sam@example.com,Yes,Yes,No,No\n",
    );

    expect(missingColumns).toEqual([]);
    expect(rows[0]).toMatchObject({
      email: "sam@example.com",
      active: true,
      is_admin: true,
      has_invoices: false,
      has_timesheet: false,
      has_expenses: true,
    });
  });

  test("a byte order mark does not hide the Title column", () => {
    // Excel and SharePoint both write one. Without stripping it the first
    // header is "\uFEFFTitle", nothing matches, and the import refuses the file.
    const { rows } = readStaffCsv(`\uFEFF${HEADER}\nsam@example.com,Sam,Yes,Yes,No,No,No\n`);

    expect(rows[0]?.email).toBe("sam@example.com");
  });

  test("no address column at all is a refusal, not an empty import", () => {
    expect(() => readStaffCsv("Name,Active\nSam,Yes\n")).toThrow(/No email column/);
  });

  test("an empty file is a refusal", () => {
    expect(() => readStaffCsv("")).toThrow(/empty/);
    expect(() => readStaffCsv("\n\n")).toThrow(/empty/);
  });

  test("a flag column the header does not name is reported, not shrugged at", () => {
    // The quiet failure this whole file exists for: everybody silently loses
    // timesheets and expenses, and the printed counts read as a real zero.
    const { rows, missingColumns } = readStaffCsv(
      "Title,Active,IsAdmin,HasInvoices\nsam@example.com,Yes,Yes,Yes\n",
    );

    expect(missingColumns).toEqual(["HasTimesheet", "HasExpenses"]);
    expect(rows[0]).toMatchObject({ has_timesheet: false, has_expenses: false });
    expect(summarise(rows).timesheet).toBe(0);
  });
});

test.describe("the flags", () => {
  test("Yes is true; No, blank and anything else are false", () => {
    const spellings = ["Yes", "yes", "YES", "true", "TRUE", "1", "y", "Y"];
    const nos = ["No", "no", "false", "0", "", "n", "maybe", "Yes please"];

    const yesRows = readStaffCsv(
      `Title,Active\n${spellings.map((s, i) => `y${i}@example.com,${s}`).join("\n")}\n`,
    ).rows;
    expect(yesRows.map((r) => r.active)).toEqual(spellings.map(() => true));

    const noRows = readStaffCsv(
      `Title,Active\n${nos.map((s, i) => `n${i}@example.com,${s}`).join("\n")}\n`,
    ).rows;
    expect(noRows.map((r) => r.active)).toEqual(nos.map(() => false));
  });

  test("surrounding whitespace does not turn a Yes into a No", () => {
    const { rows } = readStaffCsv(`${HEADER}\n  sam@example.com , Sam , Yes , Yes ,No,No,No\n`);

    expect(rows[0]).toMatchObject({
      email: "sam@example.com",
      full_name: "Sam",
      active: true,
      is_admin: true,
    });
  });

  test("a row shorter than the header keeps the flags it has and denies the rest", () => {
    const { rows } = readStaffCsv(`${HEADER}\nsam@example.com,Sam,Yes\n`);

    expect(rows[0]).toMatchObject({ active: true, is_admin: false, has_expenses: false });
  });

  test("a missing name is null, not an empty string", () => {
    const { rows } = readStaffCsv(`${HEADER}\nsam@example.com,,Yes,No,No,No,No\n`);

    expect(rows[0]?.full_name).toBeNull();
  });
});

test.describe("quoting", () => {
  test("a quoted field may contain commas", () => {
    const { rows } = readStaffCsv(
      `${HEADER}\nsam@example.com,"Reed, Samantha J",Yes,Yes,Yes,Yes,Yes\n`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.full_name).toBe("Reed, Samantha J");
    expect(rows[0]?.has_expenses).toBe(true);
  });

  test("a doubled quote is one quote, and a quoted field may contain a newline", () => {
    const { rows } = readStaffCsv(
      `${HEADER}\nsam@example.com,"Sam ""Sandy""\nReed",Yes,No,No,No,No\n`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.full_name).toBe('Sam "Sandy"\nReed');
  });

  test("CRLF endings and a file with no trailing newline both read the same", () => {
    const body = `${HEADER}\nsam@example.com,Sam,Yes,No,No,No,No\nbev@example.com,Bev,No,No,No,No,No`;

    const unix = readStaffCsv(body).rows;
    const windows = readStaffCsv(body.replace(/\n/g, "\r\n")).rows;
    const trailing = readStaffCsv(`${body}\n`).rows;

    expect(unix).toHaveLength(2);
    expect(windows).toEqual(unix);
    expect(trailing).toEqual(unix);
  });
});

test.describe("rows that are thrown away", () => {
  test("a row with no address is skipped and named", () => {
    const { rows, warnings } = readStaffCsv(
      `${HEADER}\n` +
        `sam@example.com,Sam,Yes,No,No,No,No\n` +
        `,Nobody,Yes,Yes,Yes,Yes,Yes\n` +
        `bev@example.com,Bev,Yes,No,No,No,No\n`,
    );

    expect(rows.map((r) => r.email)).toEqual(["sam@example.com", "bev@example.com"]);
    expect(warnings).toEqual(["line 3: no address, skipped"]);
  });

  test("something that is not an address is skipped rather than imported", () => {
    const { rows, warnings } = readStaffCsv(`${HEADER}\nSam Reed,Sam,Yes,Yes,Yes,Yes,Yes\n`);

    expect(rows).toEqual([]);
    expect(warnings).toEqual(['line 2: "sam reed" is not an address, skipped']);
  });

  test("a duplicate address keeps the first row and drops the later one", () => {
    // Which one wins matters: the second row here is the one granting admin.
    const { rows, warnings } = readStaffCsv(
      `${HEADER}\n` +
        `sam@example.com,Sam,Yes,No,Yes,No,No\n` +
        `SAM@Example.com,Sam Again,Yes,Yes,Yes,Yes,Yes\n`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_name: "Sam", is_admin: false, has_expenses: false });
    expect(warnings).toEqual(["line 3: sam@example.com appears twice, later one skipped"]);
  });

  test("blank lines are dropped without moving the line a warning names", () => {
    const { rows, warnings } = readStaffCsv(
      `${HEADER}\n\n\nsam@example.com,Sam,Yes,No,No,No,No\n\n,Nobody,Yes,No,No,No,No\n`,
    );

    expect(rows).toHaveLength(1);
    expect(warnings).toEqual(["line 6: no address, skipped"]);
  });
});

test.describe("the summary", () => {
  const file =
    `${HEADER}\n` +
    `sam@example.com,Sam,Yes,No,Yes,Yes,No\n` +
    `bev@example.com,Bev,Yes,Yes,Yes,No,No\n` +
    `gone@example.com,Gone,No,Yes,Yes,Yes,Yes\n`;

  test("counts people, not lines, and admins means active admins", () => {
    const counts = summarise(readStaffCsv(file).rows);

    expect(counts).toEqual({
      people: 3,
      active: 2,
      admins: 1,
      invoices: 3,
      timesheet: 2,
      expenses: 1,
      noActiveAdmin: false,
    });
  });

  test("a file with no active admin says so", () => {
    // Nobody left who can reach the admin screen: BOOTSTRAP_ADMINS is the way
    // back in, and the person running the import needs telling before they rely
    // on it.
    const { rows } = readStaffCsv(
      `${HEADER}\n` +
        `sam@example.com,Sam,Yes,No,Yes,Yes,No\n` +
        `gone@example.com,Gone,No,Yes,Yes,Yes,Yes\n`,
    );

    expect(summarise(rows).admins).toBe(0);
    expect(summarise(rows).noActiveAdmin).toBe(true);
  });

  test("an empty list has no active admin either", () => {
    expect(summarise([]).noActiveAdmin).toBe(true);
  });
});

test.describe("the reader itself", () => {
  test("parseCsv reports the line each row started on", () => {
    const rows = parseCsv('a,b\n"one\ntwo",x\nlast,y\n');

    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
    expect(rows[1]?.cells).toEqual(["one\ntwo", "x"]);
  });

  test("nothing in the reader reaches Supabase", () => {
    // The point of splitting it out of import-staff.ts: this file is testable
    // at 3am with no project, no key and no network. Keep it that way.
    const source = readFileSync(
      path.join(process.cwd(), "scripts/staff-csv.ts"),
      "utf8",
    );

    expect(source).not.toContain("@supabase");
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("process.env");
  });
});

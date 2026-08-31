import { expect, test } from "@playwright/test";
import { NO_ACTIVE_ADMIN, parseCsv, readStaffCsv } from "../scripts/staff-csv";

/**
 * The staff CSV reader — `scripts/import-staff.ts`.
 *
 * This is the one file in the suite with no browser in it. The import runs
 * once, against production, and sets the access flags for everybody, so what is
 * pinned here is the mapping itself: which header becomes which column, what
 * counts as Yes, and what the reader refuses to guess at. It reaches no
 * Supabase project and reads nothing off disk — the script's own half does both,
 * and is deliberately not imported here.
 *
 * Goes when the script goes, at cutover.
 */

/** The header the SharePoint export writes, with the columns it writes. */
const HEADER = "Title,OfficialName,Active,IsAdmin,HasInvoices,HasTimesheet,HasExpenses";

const one = (csv: string) => {
  const { rows } = readStaffCsv(csv);
  expect(rows, "expected exactly one person").toHaveLength(1);
  return rows[0]!;
};

test.describe("the mapping", () => {
  test("Title is the address, and OfficialName the name", () => {
    const row = one(`${HEADER}\nwez@example.com,Wesley Hughes,Yes,Yes,Yes,No,No`);

    expect(row.email).toBe("wez@example.com");
    expect(row.full_name).toBe("Wesley Hughes");
  });

  test("Email or Address stands in for Title", () => {
    expect(one("Email,Name\nwez@example.com,Wes").email).toBe("wez@example.com");
    expect(one("Address,Full Name\nwez@example.com,Wes").email).toBe("wez@example.com");
  });

  test("headers match whatever their case and spacing, and extra columns are ignored", () => {
    const row = one(
      "Department, title ,Cost Centre,ACTIVE,is admin\n" +
        "Finance,WEZ@Example.com ,CC-1,yes,YES",
    );

    expect(row.email).toBe("wez@example.com");
    expect(row.active).toBe(true);
    expect(row.is_admin).toBe(true);
  });

  test("each flag lands in its own column", () => {
    const row = one(`${HEADER}\nwez@example.com,Wes,Yes,No,Yes,No,Yes`);

    expect(row).toEqual({
      email: "wez@example.com",
      full_name: "Wes",
      active: true,
      is_admin: false,
      has_invoices: true,
      has_timesheet: false,
      has_expenses: true,
    });
  });

  test("a missing name is null rather than an empty string", () => {
    expect(one(`${HEADER}\nwez@example.com,,Yes,No,No,No,No`).full_name).toBeNull();
    expect(one("Title,Active\nwez@example.com,Yes").full_name).toBeNull();
  });
});

test.describe("Yes and No", () => {
  for (const yes of ["Yes", "yes", "YES", "true", "TRUE", "1", "y", " Yes "]) {
    test(`"${yes}" grants access`, () => {
      expect(one(`Title,HasInvoices\nwez@example.com,${yes}`).has_invoices).toBe(true);
    });
  }

  // The one that matters: anything the export might write for "not this person"
  // has to come back false, including things nobody thought of.
  for (const no of ["No", "no", "NO", "false", "0", "n", "", "  ", "-", "Pending"]) {
    test(`"${no}" does not`, () => {
      expect(one(`Title,HasInvoices\nwez@example.com,${no}`).has_invoices).toBe(false);
    });
  }
});

test.describe("quoting", () => {
  test("a comma inside a quoted field does not split it", () => {
    const row = one(`${HEADER}\n"wez@example.com","Hughes, Wesley",Yes,Yes,No,No,No`);

    expect(row.full_name).toBe("Hughes, Wesley");
    expect(row.email).toBe("wez@example.com");
    expect(row.is_admin).toBe(true);
  });

  test("a quoted field keeps the columns after it lined up", () => {
    const { rows } = readStaffCsv(
      `${HEADER}\n` +
        `a@example.com,"Adams, A, Jr",Yes,No,Yes,No,No\n` +
        `b@example.com,Bell,Yes,No,No,Yes,No\n`,
    );

    expect(rows.map((r) => [r.email, r.has_invoices, r.has_timesheet])).toEqual([
      ["a@example.com", true, false],
      ["b@example.com", false, true],
    ]);
  });

  test("an escaped quote is one quote, and a newline inside quotes is not a new row", () => {
    const { rows } = readStaffCsv(
      `${HEADER}\n"wez@example.com","Wes ""The Boss""\nHughes",Yes,No,No,No,No`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.full_name).toBe('Wes "The Boss"\nHughes');
  });

  test("CRLF line endings and a trailing newline read the same as neither", () => {
    const { rows } = readStaffCsv(
      `Title,Active\r\na@example.com,Yes\r\nb@example.com,No\r\n\r\n`,
    );

    expect(rows.map((r) => r.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(rows.map((r) => r.active)).toEqual([true, false]);
  });

  test("the BOM Excel writes is not part of the first header", () => {
    // Without this the email column goes missing and the whole import throws.
    const { rows } = readStaffCsv(`﻿${HEADER}\nwez@example.com,Wes,Yes,No,No,No,No`);

    expect(rows.map((r) => r.email)).toEqual(["wez@example.com"]);
  });
});

test.describe("rows it will not take at face value", () => {
  test("a row with no address is skipped, and said so", () => {
    const { rows, warnings } = readStaffCsv(
      `${HEADER}\n` +
        `a@example.com,A,Yes,Yes,No,No,No\n` +
        `,Nobody,Yes,Yes,Yes,Yes,Yes\n` +
        `b@example.com,B,Yes,No,No,No,No\n`,
    );

    expect(rows.map((r) => r.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(warnings).toContain("line 3: no address, skipped");
  });

  test("something that is not an address is skipped rather than imported", () => {
    const { rows, warnings } = readStaffCsv(
      `${HEADER}\nWesley Hughes,W,Yes,Yes,Yes,Yes,Yes\n`,
    );

    expect(rows).toEqual([]);
    expect(warnings).toContain(`line 2: "wesley hughes" is not an address, skipped`);
  });

  test("a duplicate address keeps the first row and warns about the second", () => {
    // The second row is the permissive one: if "later wins" ever became the
    // behaviour, this person would quietly gain admin.
    const { rows, warnings } = readStaffCsv(
      `${HEADER}\n` +
        `wez@example.com,Wes,Yes,No,Yes,No,No\n` +
        `WEZ@Example.com,Wes Again,Yes,Yes,Yes,Yes,Yes\n`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_admin).toBe(false);
    expect(rows[0]!.full_name).toBe("Wes");
    expect(warnings).toContain("line 3: wez@example.com appears twice, later one skipped");
  });

  test("a blank line between people is not a person", () => {
    const { rows, warnings } = readStaffCsv(
      `Title,Active\na@example.com,Yes\n\n,\nb@example.com,Yes\n`,
    );

    expect(rows.map((r) => r.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(warnings.filter((w) => w.includes("no address"))).toEqual([]);
  });
});

test.describe("what it refuses to guess at", () => {
  test("an empty file throws", () => {
    expect(() => readStaffCsv("")).toThrow("The file is empty.");
    expect(() => readStaffCsv("\n\n")).toThrow("The file is empty.");
  });

  test("no email column throws, and names the headers it did find", () => {
    expect(() => readStaffCsv("Person,Active\nWes,Yes")).toThrow(
      /No email column.*found: Person, Active/s,
    );
  });

  test("a missing flag column is a warning, not a silent grant of nothing", () => {
    // Everybody imported inactive is not dangerous, but it is a wasted one-off
    // run against production, and the counts alone would not say why.
    const { rows, warnings } = readStaffCsv("Title,OfficialName\nwez@example.com,Wes");

    expect(rows[0]!.active).toBe(false);
    expect(warnings).toEqual([
      "no Active column; everybody will be imported with it off",
      "no IsAdmin column; everybody will be imported with it off",
      "no HasInvoices column; everybody will be imported with it off",
      "no HasTimesheet column; everybody will be imported with it off",
      "no HasExpenses column; everybody will be imported with it off",
      NO_ACTIVE_ADMIN,
    ]);
  });
});

test.describe("no active admin", () => {
  test("a file with nobody active and admin warns", () => {
    const { warnings, counts } = readStaffCsv(
      `${HEADER}\n` +
        `a@example.com,A,Yes,No,Yes,No,No\n` +
        `b@example.com,B,No,Yes,No,No,No\n`, // an admin, but not active
    );

    expect(counts.activeAdmins).toBe(0);
    expect(warnings).toContain(NO_ACTIVE_ADMIN);
    expect(NO_ACTIVE_ADMIN).toContain("BOOTSTRAP_ADMINS");
  });

  test("one active admin is enough for the warning to stay away", () => {
    const { warnings, counts } = readStaffCsv(
      `${HEADER}\n` +
        `a@example.com,A,Yes,Yes,No,No,No\n` +
        `b@example.com,B,Yes,No,No,No,No\n`,
    );

    expect(counts.activeAdmins).toBe(1);
    expect(warnings).toEqual([]);
  });
});

test.describe("the counts the run prints", () => {
  test("count what was imported, not what was in the file", () => {
    const { counts } = readStaffCsv(
      `${HEADER}\n` +
        `a@example.com,A,Yes,Yes,Yes,Yes,No\n` +
        `a@example.com,A again,Yes,Yes,Yes,Yes,Yes\n` + // skipped
        `,Nobody,Yes,Yes,Yes,Yes,Yes\n` + // skipped
        `b@example.com,B,No,No,Yes,No,Yes\n`,
    );

    expect(counts).toEqual({
      people: 2,
      active: 1,
      activeAdmins: 1,
      invoices: 2,
      timesheet: 1,
      expenses: 1,
    });
  });
});

test.describe("parseCsv on its own", () => {
  test("returns the header and the body as rows of cells", () => {
    expect(parseCsv('a,b\n1,"2,3"\n')).toEqual([
      ["a", "b"],
      ["1", "2,3"],
    ]);
  });

  test("a row of empty cells is dropped", () => {
    expect(parseCsv('a,b\n,\n"",""\n1,2')).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("a short row is short rather than padded", () => {
    expect(parseCsv("a,b,c\n1,2")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ]);
  });
});

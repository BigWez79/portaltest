import "server-only";
import { staffSource } from "./env";
import type { StaffRow } from "./staff";
import { FLAG_COLUMN, FLAGS, type Flag } from "./staff-admin";

/**
 * What `staff_audit` holds, read back for the admin screen.
 *
 * The table has recorded every insert and update to `staff` since 0001 and
 * nothing has ever read it. It is read here through the caller's own session:
 * the "admins read the audit" policy is what returns more than nothing, so a
 * missing guard upstream cannot turn this into a log of who changed what.
 *
 * Only access changes are reported. The trigger also fires when a person first
 * signs in — the link trigger writes `user_id` and `last_seen_at` — and an entry
 * where no flag moved is dropped rather than shown as a change nobody made.
 */

/** The flags of one row, in the one shape both sources are compared in. */
export type FlagSnapshot = Partial<Record<Flag, boolean>>;

export type AuditChange = {
  /** "Granted Expenses", "Deactivated" — already phrased for the screen. */
  text: string;
  granted: boolean;
};

export type AuditEntry = {
  id: string;
  /** whose access changed */
  email: string;
  /** ISO 8601 */
  at: string;
  /** who changed it; null when nothing recorded an account */
  byName: string | null;
  kind: "added" | "changed";
  changes: AuditChange[];
};

export type AuditGroup = {
  email: string;
  name: string | null;
  entries: AuditEntry[];
  /** how many were left off the end of `entries` */
  more: number;
};

/** Per person, on screen. Enough to see the last few decisions, not a ledger. */
export const ENTRIES_PER_PERSON = 6;

/** Newest first, across everybody, before grouping. */
const FETCH_LIMIT = 200;

const LABEL: Record<Flag, string> = {
  active: "Active",
  isAdmin: "Admin",
  hasInvoices: "Invoices",
  hasTimesheet: "Timesheets",
  hasExpenses: "Expenses",
  hasMargin: "Margin",
  hasTaxBreakdown: "Tax Breakdown",
};

/** How one flag moving reads in a sentence. */
function phrase(flag: Flag, granted: boolean): string {
  if (flag === "active") return granted ? "Reactivated" : "Deactivated";
  if (flag === "isAdmin") return granted ? "Made an admin" : "Admin removed";
  return `${granted ? "Granted" : "Removed"} ${LABEL[flag]}`;
}

export function diffFlags(before: FlagSnapshot | null, after: FlagSnapshot): AuditChange[] {
  if (!before) return [];
  return FLAGS.filter((flag) => before[flag] !== after[flag]).map((flag) => ({
    text: phrase(flag, after[flag] === true),
    granted: after[flag] === true,
  }));
}

/** One jsonb row from `staff_audit` reduced to the flags this screen cares about. */
function snapshotFromColumns(row: unknown): FlagSnapshot | null {
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const snapshot: FlagSnapshot = {};
  for (const flag of FLAGS) snapshot[flag] = source[FLAG_COLUMN[flag]] === true;
  return snapshot;
}

// One string literal, like STAFF_COLUMNS: supabase-js infers the row type from
// it, and a concatenation turns the whole select into an error type.
// prettier-ignore
const AUDIT_COLUMNS = "id, staff_email, changed_by, changed_at, before, after";

/**
 * Every recorded access change, newest first, grouped by the person it was made
 * against.
 *
 * `changed_by` is an auth user id, so the names are resolved from `staff` —
 * itself read through the caller's session. There is no foreign key between the
 * two to embed across, and inventing one would mean a migration for a join that
 * a second small read does just as well.
 */
export async function listAuditTrail(staff: StaffRow[]): Promise<AuditGroup[]> {
  const names = new Map(
    staff.filter((r) => r.fullName).map((r) => [r.email, r.fullName as string]),
  );

  const entries =
    staffSource() === "fixture" ? await fromFixture(names) : await fromSupabase();

  const groups = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.email) ?? [];
    list.push(entry);
    groups.set(entry.email, list);
  }

  return [...groups.entries()]
    .map(([email, list]) => ({
      email,
      name: names.get(email) ?? null,
      entries: list.slice(0, ENTRIES_PER_PERSON),
      more: Math.max(0, list.length - ENTRIES_PER_PERSON),
    }))
    .sort((a, b) => (b.entries[0]?.at ?? "").localeCompare(a.entries[0]?.at ?? ""));
}

async function fromSupabase(): Promise<AuditEntry[]> {
  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  const { data, error } = await client
    .from("staff_audit")
    .select(AUDIT_COLUMNS)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(FETCH_LIMIT);

  if (error) {
    console.error("[staff-audit] read failed", error.message);
    return [];
  }

  const byUser = await authorNames();

  return (data ?? [])
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      const before = snapshotFromColumns(row.before);
      const after = snapshotFromColumns(row.after) ?? {};
      const changedBy = row.changed_by as string | null;

      return {
        id: String(row.id),
        email: String(row.staff_email ?? "").toLowerCase(),
        at: String(row.changed_at ?? ""),
        byName: (changedBy && byUser.get(changedBy)) || null,
        kind: before ? ("changed" as const) : ("added" as const),
        changes: diffFlags(before, after),
      };
    })
    .filter(worthShowing);
}

/**
 * auth user id -> name, for whoever made a change.
 *
 * `user_id` is not in STAFF_COLUMNS because no page needs it; this is the one
 * read that does. Still the caller's session, still the admin policy.
 */
async function authorNames(): Promise<Map<string, string>> {
  const { supabaseServer } = await import("./supabase/server");
  const client = await supabaseServer();

  const { data, error } = await client.from("staff").select("user_id, email, full_name");
  if (error) {
    console.error("[staff-audit] author lookup failed", error.message);
    return new Map();
  }

  const names = new Map<string, string>();
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const id = row.user_id as string | null;
    if (!id) continue;
    names.set(id, (row.full_name as string | null) || String(row.email ?? ""));
  }
  return names;
}

async function fromFixture(nameFor: Map<string, string>): Promise<AuditEntry[]> {
  const { auditStore } = await import("./audit-store");
  const records = await auditStore.all();

  return records
    .map((record) => ({
      id: record.id,
      email: record.email,
      at: record.at,
      byName: record.byEmail ? nameFor.get(record.byEmail) ?? record.byEmail : null,
      kind: record.before ? ("changed" as const) : ("added" as const),
      changes: diffFlags(record.before, record.after),
    }))
    .filter(worthShowing)
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
    .slice(0, FETCH_LIMIT);
}

/** An entry nothing moved in is the sign-in trigger, not a decision. */
const worthShowing = (entry: AuditEntry) =>
  entry.kind === "added" || entry.changes.length > 0;

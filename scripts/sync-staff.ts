/**
 * SharePoint Staff list -> Supabase staff table. One way, always.
 *
 *   npm run sync:staff -- --check    report differences, write nothing, exit 1 if any
 *   npm run sync:staff               apply
 *
 * SharePoint stays the master while Invoices, Timesheets and Expenses read it.
 * Nothing in this script writes back to SharePoint, and it must stay that way
 * while that is true — see BLOCKED.md.
 *
 * Uses app-only (client credentials) Graph access with Sites.Selected granted on
 * the PowerAnalytix site alone. That is the only Graph permission anywhere in
 * this project, it lives on this job, and it never reaches a browser.
 */
import { createClient } from "@supabase/supabase-js";

type Fields = Record<string, unknown>;

type StaffRecord = {
  email: string;
  upn: string | null;
  official_name: string | null;
  active: boolean;
  is_admin: boolean;
  has_invoices: boolean;
  has_timesheet: boolean;
  has_expenses: boolean;
  source_item_id: string;
};

const CHECK_ONLY = process.argv.includes("--check");

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const yes = (v: unknown) => v === true || v === "true" || v === "Yes" || v === "1";

async function graphToken(): Promise<string> {
  const tenant = env("ENTRA_TENANT_ID");
  const body = new URLSearchParams({
    client_id: env("SYNC_CLIENT_ID"),
    client_secret: env("SYNC_CLIENT_SECRET"),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function readSharePoint(): Promise<StaffRecord[]> {
  const token = await graphToken();
  const siteId = env("STAFF_SITE_ID");
  const listId = env("STAFF_LIST_ID");

  const rows: StaffRecord[] = [];
  let url:
    | string
    | undefined = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly",
      },
    });
    if (!res.ok) throw new Error(`Graph read failed: ${res.status} ${await res.text()}`);

    const page = (await res.json()) as {
      value: Array<{ id: string; fields?: Fields }>;
      "@odata.nextLink"?: string;
    };

    for (const item of page.value) {
      const f = item.fields ?? {};
      const email = String(f.Title ?? "").trim().toLowerCase();
      if (!email) {
        console.warn(`[sync] item ${item.id} has no Title, skipping`);
        continue;
      }
      rows.push({
        email,
        upn: f.UPN ? String(f.UPN).trim().toLowerCase() : null,
        official_name: f.OfficialName ? String(f.OfficialName) : null,
        active: yes(f.Active),
        is_admin: yes(f.IsAdmin),
        has_invoices: yes(f.HasInvoices),
        has_timesheet: yes(f.HasTimesheet),
        has_expenses: yes(f.HasExpenses),
        source_item_id: String(item.id),
      });
    }

    url = page["@odata.nextLink"];
  }

  return rows;
}

function differences(source: StaffRecord[], target: StaffRecord[]): string[] {
  const byEmail = new Map(target.map((r) => [r.email, r]));
  const out: string[] = [];

  for (const s of source) {
    const t = byEmail.get(s.email);
    if (!t) {
      out.push(`missing in supabase: ${s.email}`);
      continue;
    }
    for (const key of [
      "upn",
      "official_name",
      "active",
      "is_admin",
      "has_invoices",
      "has_timesheet",
      "has_expenses",
    ] as const) {
      if (s[key] !== t[key]) {
        out.push(`${s.email}: ${key} ${String(t[key])} -> ${String(s[key])}`);
      }
    }
    byEmail.delete(s.email);
  }

  for (const orphan of byEmail.keys()) {
    out.push(`in supabase but no longer in sharepoint: ${orphan}`);
  }

  return out;
}

async function main() {
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const source = await readSharePoint();
  console.log(`[sync] read ${source.length} rows from SharePoint`);

  const { data, error } = await supabase
    .from("staff")
    .select(
      "email, upn, official_name, active, is_admin, has_invoices, has_timesheet, has_expenses, source_item_id",
    );
  if (error) throw new Error(`Supabase read failed: ${error.message}`);

  const diffs = differences(source, (data ?? []) as unknown as StaffRecord[]);

  if (diffs.length === 0) {
    console.log("[sync] no differences");
    return;
  }

  console.log(`[sync] ${diffs.length} difference(s):`);
  for (const d of diffs) console.log(`  - ${d}`);

  if (CHECK_ONLY) {
    process.exitCode = 1;
    return;
  }

  const stamped = source.map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  const { error: upsertError } = await supabase
    .from("staff")
    .upsert(stamped, { onConflict: "email" });
  if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message}`);

  // A person who has left SharePoint is deactivated here, never deleted — the
  // row is the only record of what they used to have.
  const live = source.map((r) => r.email);
  const { error: deactivateError } = await supabase
    .from("staff")
    .update({ active: false, is_admin: false })
    .not("email", "in", `(${live.map((e) => `"${e}"`).join(",")})`);
  if (deactivateError) {
    throw new Error(`Supabase deactivate failed: ${deactivateError.message}`);
  }

  console.log(`[sync] applied ${source.length} rows`);
}

main().catch((err: unknown) => {
  console.error("[sync] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

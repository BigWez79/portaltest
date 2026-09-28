import "server-only";
import { staffSource } from "./env";
import type { Contractor, Drawing, Job, Method } from "./margin-split-calc";

/**
 * Margin Split's records — jobs, contractors and drawings.
 *
 * Every call runs as the caller, so 0012_margin_split.sql's policies decide:
 * an active admin reads and writes, nobody else sees a row. The actions check
 * isAdmin first as well (rule 5); in fixture mode that check is the only one.
 */

export * from "./margin-split-calc";

export type Book = { jobs: Job[]; contractors: Contractor[]; drawings: Drawing[] };

async function client() {
  const { supabaseServer } = await import("./supabase/server");
  return supabaseServer();
}

async function store() {
  return (await import("./margin-split-store")).marginSplitStore;
}

export async function readBook(): Promise<Book> {
  if (staffSource() === "fixture") return (await store()).read();

  const db = await client();
  const [jobs, contractors, drawings] = await Promise.all([
    db.from("margin_split_jobs").select("id, name, job_date, value_pence, margin_bp").order("job_date"),
    db.from("margin_split_contractors").select("id, name, share_bp, position").order("position"),
    db
      .from("margin_split_drawings")
      .select("id, contractor_id, drawn_on, amount_pence, method, note")
      .order("drawn_on"),
  ]);
  const failed = jobs.error ?? contractors.error ?? drawings.error;
  if (failed) {
    // Thrown, not an empty book: an empty book renders a pot of £0.00, which
    // is a confident wrong answer about money.
    throw new Error(`[margin-split] read failed: ${failed.message}`);
  }

  type Row = Record<string, unknown>;
  return {
    jobs: (jobs.data as Row[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      jobDate: String(r.job_date),
      valuePence: Number(r.value_pence),
      marginBp: Number(r.margin_bp),
    })),
    contractors: (contractors.data as Row[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      shareBp: Number(r.share_bp),
      position: Number(r.position),
    })),
    drawings: (drawings.data as Row[]).map((r) => ({
      id: String(r.id),
      contractorId: String(r.contractor_id),
      drawnOn: String(r.drawn_on),
      amountPence: Number(r.amount_pence),
      method: String(r.method) as Method,
      note: r.note == null ? null : String(r.note),
    })),
  };
}

function done(what: string, error: { message: string } | null): boolean {
  if (error) console.error(`[margin-split] ${what} failed`, error.message);
  return !error;
}

export async function addJob(job: Omit<Job, "id">): Promise<boolean> {
  if (staffSource() === "fixture") return (await store()).addJob(job);
  const { error } = await (await client()).from("margin_split_jobs").insert({
    name: job.name,
    job_date: job.jobDate,
    value_pence: job.valuePence,
    margin_bp: job.marginBp,
  });
  return done("add job", error);
}

/** A new contractor starts on a 0% share, so the total stays at 10000. */
export async function addContractor(name: string): Promise<boolean> {
  if (staffSource() === "fixture") return (await store()).addContractor(name);
  const { error } = await (await client()).rpc("margin_split_add_contractor", { p_name: name });
  return done("add contractor", error);
}

/** Names and shares together, in one transaction, refused unless they total 10000. */
export async function setShares(rows: { id: string; name: string; shareBp: number }[]): Promise<boolean> {
  if (staffSource() === "fixture") return (await store()).setShares(rows);
  const { error } = await (await client()).rpc("margin_split_set_shares", {
    p_rows: rows.map((r) => ({ id: r.id, name: r.name, share_bp: r.shareBp })),
  });
  return done("set shares", error);
}

export async function addDrawing(drawing: Omit<Drawing, "id">): Promise<boolean> {
  if (staffSource() === "fixture") return (await store()).addDrawing(drawing);
  const { error } = await (await client()).from("margin_split_drawings").insert({
    contractor_id: drawing.contractorId,
    drawn_on: drawing.drawnOn,
    amount_pence: drawing.amountPence,
    method: drawing.method,
    note: drawing.note,
  });
  return done("add drawing", error);
}

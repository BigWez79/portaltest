import "server-only";
import { staffSource } from "./env";
import type { DrawMethod, MsData, MsDrawing, MsJob } from "./margin-split-calc";

/**
 * Margin Split — jobs feeding a shared pot, contractors drawing from it.
 * Admin only, at /admin/margin-split. Not an app and not a tile.
 *
 * Every read and write goes through the caller's own session, so the policies
 * in 0012_margin_split.sql decide: an active admin reads and writes, nobody
 * else sees a row. Nothing here reaches for the service role (rule 2).
 *
 * The arithmetic is in margin-split-calc.ts, which the browser may import.
 * This file may not be.
 */

export * from "./margin-split-calc";

export type MsResult = { ok: true } | { ok: false; message: string };

/** A row from the contractors form. No id means a contractor being added. */
export type ContractorInput = { id?: string; name: string; shareBp: number };

const EMPTY: MsData = { jobs: [], contractors: [], drawings: [] };

async function store() {
  return (await import("./margin-split-store")).marginSplitStore;
}

async function client() {
  const { supabaseServer } = await import("./supabase/server");
  return supabaseServer();
}

/* -------------------------------------------------------------------------
   Reads
   ------------------------------------------------------------------------- */

/**
 * Everything, for the one page that shows it. The caller must be an admin; in
 * fixture mode there is no policy to lean on, so that check is all there is.
 */
export async function loadMarginSplit(): Promise<MsData> {
  if (staffSource() === "fixture") return (await store()).data();

  const db = await client();
  const [jobs, contractors, drawings] = await Promise.all([
    db.from("margin_split_jobs").select("id, name, job_date, value_pence, margin_bp").order("job_date"),
    db.from("margin_split_contractors").select("id, name, share_bp, position").order("position"),
    db
      .from("margin_split_drawings")
      .select("id, contractor_id, draw_date, amount_pence, method, note")
      .order("draw_date"),
  ]);

  const failed = jobs.error ?? contractors.error ?? drawings.error;
  if (failed) {
    console.error("[margin-split] load failed", failed.message);
    return EMPTY;
  }

  return {
    jobs: (jobs.data ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      jobDate: String(r.job_date),
      valuePence: Number(r.value_pence),
      marginBp: Number(r.margin_bp),
    })),
    contractors: (contractors.data ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      shareBp: Number(r.share_bp),
      position: Number(r.position),
    })),
    drawings: (drawings.data ?? []).map((r) => ({
      id: String(r.id),
      contractorId: String(r.contractor_id),
      drawDate: String(r.draw_date),
      amountPence: Number(r.amount_pence),
      method: r.method as DrawMethod,
      note: r.note == null ? null : String(r.note),
    })),
  };
}

/* -------------------------------------------------------------------------
   Writes — always as the caller, never as the service role
   ------------------------------------------------------------------------- */

export async function addJob(input: Omit<MsJob, "id">): Promise<MsResult> {
  if (staffSource() === "fixture") return (await store()).addJob(input);

  const { error } = await (await client()).from("margin_split_jobs").insert({
    name: input.name,
    job_date: input.jobDate,
    value_pence: input.valuePence,
    margin_bp: input.marginBp,
  });
  if (error) {
    console.error("[margin-split] add job failed", error.message);
    return { ok: false, message: "That job could not be saved." };
  }
  return { ok: true };
}

export async function removeJob(id: string): Promise<MsResult> {
  if (staffSource() === "fixture") return (await store()).removeJob(id);

  const { error } = await (await client()).from("margin_split_jobs").delete().eq("id", id);
  if (error) {
    console.error("[margin-split] remove job failed", error.message);
    return { ok: false, message: "That job could not be removed." };
  }
  return { ok: true };
}

/**
 * The whole list in one call, so the shares are checked as a set. Row by row
 * over PostgREST, the first update would leave the total off 10000 and the
 * deferred check in the migration would refuse it — or worse, with no check, a
 * failure halfway would leave it that way.
 */
export async function saveContractors(list: ContractorInput[]): Promise<MsResult> {
  if (staffSource() === "fixture") return (await store()).saveContractors(list);

  const { error } = await (await client()).rpc("save_margin_split_contractors", {
    list: list.map((c) => ({ id: c.id ?? null, name: c.name, share_bp: c.shareBp })),
  });
  if (error) {
    console.error("[margin-split] save contractors failed", error.message);
    return { ok: false, message: "The contractors could not be saved. Shares must total exactly 100%." };
  }
  return { ok: true };
}

export async function addDrawing(input: Omit<MsDrawing, "id">): Promise<MsResult> {
  if (staffSource() === "fixture") return (await store()).addDrawing(input);

  const { error } = await (await client()).from("margin_split_drawings").insert({
    contractor_id: input.contractorId,
    draw_date: input.drawDate,
    amount_pence: input.amountPence,
    method: input.method,
    note: input.note,
  });
  if (error) {
    console.error("[margin-split] add drawing failed", error.message);
    return { ok: false, message: "That drawing could not be saved." };
  }
  return { ok: true };
}

export async function removeDrawing(id: string): Promise<MsResult> {
  if (staffSource() === "fixture") return (await store()).removeDrawing(id);

  const { error } = await (await client()).from("margin_split_drawings").delete().eq("id", id);
  if (error) {
    console.error("[margin-split] remove drawing failed", error.message);
    return { ok: false, message: "That drawing could not be removed." };
  }
  return { ok: true };
}

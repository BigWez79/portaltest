"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import {
  FULL_SHARE,
  MAX_PENCE,
  METHODS,
  type Method,
  addContractor,
  addDrawing,
  addJob,
  hundredths,
  readBook,
  setShares,
} from "@/lib/margin-split";
import { resolveAccess } from "@/lib/staff";

export type SplitState = { status: "idle" | "ok" | "error"; message?: string };

const REFUSED: SplitState = { status: "error", message: "Only an admin can change Margin Split." };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rule 5: every action here is a public endpoint, and the page's requireApp
 * does nothing for a request that never loads the page.
 */
async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return (await resolveAccess(user)).isAdmin;
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function saved(message: string): SplitState {
  revalidatePath("/admin/margin-split");
  return { status: "ok", message };
}

export async function submitJob(_previous: SplitState, formData: FormData): Promise<SplitState> {
  if (!(await isAdmin())) return REFUSED;

  const name = text(formData, "name");
  const jobDate = text(formData, "jobDate");
  const valuePence = hundredths(text(formData, "value"));
  const marginBp = hundredths(text(formData, "margin"));

  if (!name) return { status: "error", message: "Give the job a name." };
  if (!DATE.test(jobDate)) return { status: "error", message: "Choose the job's date." };
  if (valuePence === null || valuePence > MAX_PENCE) {
    return { status: "error", message: "Enter the value in pounds, for example 1250.00." };
  }
  if (marginBp === null || marginBp > FULL_SHARE) {
    return { status: "error", message: "Enter a margin between 0 and 100%, to two decimal places." };
  }

  if (!(await addJob({ name, jobDate, valuePence, marginBp }))) {
    return { status: "error", message: "The job could not be saved." };
  }
  return saved("Job added.");
}

export async function submitContractor(_previous: SplitState, formData: FormData): Promise<SplitState> {
  if (!(await isAdmin())) return REFUSED;

  const name = text(formData, "name");
  if (!name) return { status: "error", message: "Give the contractor a name." };
  if (!(await addContractor(name))) return { status: "error", message: "The contractor could not be added." };
  return saved("Contractor added on a 0% share. Set the shares below.");
}

export async function submitShares(_previous: SplitState, formData: FormData): Promise<SplitState> {
  if (!(await isAdmin())) return REFUSED;

  const { contractors } = await readBook();
  const rows = [];
  for (const c of contractors) {
    const name = text(formData, `name-${c.id}`);
    const shareBp = hundredths(text(formData, `share-${c.id}`));
    if (!name) return { status: "error", message: "Every contractor needs a name." };
    if (shareBp === null) {
      return { status: "error", message: `Enter ${name}'s share as a percentage, to two decimal places.` };
    }
    rows.push({ id: c.id, name, shareBp });
  }

  const total = rows.reduce((s, r) => s + r.shareBp, 0);
  if (total !== FULL_SHARE) {
    return {
      status: "error",
      message: `Shares must total exactly 100%. These total ${(total / 100).toFixed(2)}%, so nothing was saved.`,
    };
  }
  if (!(await setShares(rows))) return { status: "error", message: "The shares could not be saved." };
  return saved("Shares saved.");
}

export async function submitDrawing(_previous: SplitState, formData: FormData): Promise<SplitState> {
  if (!(await isAdmin())) return REFUSED;

  const contractorId = text(formData, "contractorId");
  const drawnOn = text(formData, "drawnOn");
  const amountPence = hundredths(text(formData, "amount"));
  const method = text(formData, "method") as Method;

  if (!contractorId) return { status: "error", message: "Choose a contractor." };
  if (!DATE.test(drawnOn)) return { status: "error", message: "Choose the date of the drawing." };
  if (amountPence === null || amountPence <= 0 || amountPence > MAX_PENCE) {
    return { status: "error", message: "Enter the amount in pounds, for example 250.00." };
  }
  if (!METHODS.includes(method)) return { status: "error", message: "Choose cash or bank transfer." };

  const note = text(formData, "note") || null;
  if (!(await addDrawing({ contractorId, drawnOn, amountPence, method, note }))) {
    return { status: "error", message: "The drawing could not be saved." };
  }
  return saved("Drawing added.");
}

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import {
  DRAW_METHODS,
  WHOLE_BP,
  type ContractorInput,
  type DrawMethod,
  addDrawing,
  addJob,
  parseBp,
  parsePence,
  removeDrawing,
  removeJob,
  saveContractors,
} from "@/lib/margin-split";
import { resolveAccess } from "@/lib/staff";

export type MsState = { status: "idle" | "ok" | "error"; message?: string };

const PATH = "/admin/margin-split";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REFUSED: MsState = { status: "error", message: "Only an admin can change the margin split." };

/**
 * Every action re-checks the caller (rule 5). The page's requireApp("admin")
 * protects the page; it does nothing for somebody posting to these directly.
 */
async function isAdminCaller(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return (await resolveAccess(user)).isAdmin;
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function submitJob(_previous: MsState, formData: FormData): Promise<MsState> {
  if (!(await isAdminCaller())) return REFUSED;

  const name = text(formData, "name");
  const jobDate = text(formData, "jobDate");
  const valuePence = parsePence(text(formData, "value"));
  const marginBp = parseBp(text(formData, "margin"));

  if (!name) return { status: "error", message: "Give the job a name." };
  if (!DATE.test(jobDate)) return { status: "error", message: "Choose the job's date." };
  if (valuePence === null) return { status: "error", message: "Enter the value in pounds and pence." };
  if (marginBp === null) return { status: "error", message: "Enter a margin between 0 and 100%, to two decimal places." };

  const result = await addJob({ name, jobDate, valuePence, marginBp });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(PATH);
  return { status: "ok", message: "Job added." };
}

export async function deleteJob(_previous: MsState, formData: FormData): Promise<MsState> {
  if (!(await isAdminCaller())) return REFUSED;

  const id = text(formData, "id");
  if (!id) return { status: "error", message: "Nothing to remove." };

  const result = await removeJob(id);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(PATH);
  return { status: "ok", message: "Job removed." };
}

/**
 * The whole contractor list at once: ids[], names[] and shares[] in step, with
 * a blank id for a contractor being added. A new row left without a name is
 * the empty "add somebody" line, not a contractor.
 */
export async function submitContractors(_previous: MsState, formData: FormData): Promise<MsState> {
  if (!(await isAdminCaller())) return REFUSED;

  const ids = formData.getAll("id").map(String);
  const names = formData.getAll("name").map((n) => String(n).trim());
  const shares = formData.getAll("share").map((s) => String(s).trim());
  if (ids.length !== names.length || ids.length !== shares.length) {
    return { status: "error", message: "The form was incomplete. Reload and try again." };
  }

  const list: ContractorInput[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] || undefined;
    if (!id && !names[i]) continue;
    if (!names[i]) return { status: "error", message: "Every contractor needs a name." };
    const shareBp = parseBp(shares[i] || "0");
    if (shareBp === null) {
      return { status: "error", message: `${names[i]}'s share must be between 0 and 100%, to two decimal places.` };
    }
    list.push({ id, name: names[i], shareBp });
  }

  const total = list.reduce((s, c) => s + c.shareBp, 0);
  if (total !== WHOLE_BP) {
    return {
      status: "error",
      message: `Shares must total exactly 100%. These total ${(total / 100).toFixed(2)}%.`,
    };
  }

  const result = await saveContractors(list);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(PATH);
  return { status: "ok", message: "Contractors saved." };
}

export async function submitDrawing(_previous: MsState, formData: FormData): Promise<MsState> {
  if (!(await isAdminCaller())) return REFUSED;

  const contractorId = text(formData, "contractorId");
  const drawDate = text(formData, "drawDate");
  const amountPence = parsePence(text(formData, "amount"));
  const method = text(formData, "method") as DrawMethod;
  const note = text(formData, "note") || null;

  if (!contractorId) return { status: "error", message: "Choose a contractor." };
  if (!DATE.test(drawDate)) return { status: "error", message: "Choose the date it was drawn." };
  if (amountPence === null || amountPence <= 0) {
    return { status: "error", message: "Enter the amount in pounds and pence." };
  }
  if (!DRAW_METHODS.includes(method)) return { status: "error", message: "Choose cash or bank transfer." };

  const result = await addDrawing({ contractorId, drawDate, amountPence, method, note });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(PATH);
  return { status: "ok", message: "Drawing added." };
}

export async function deleteDrawing(_previous: MsState, formData: FormData): Promise<MsState> {
  if (!(await isAdminCaller())) return REFUSED;

  const id = text(formData, "id");
  if (!id) return { status: "error", message: "Nothing to remove." };

  const result = await removeDrawing(id);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(PATH);
  return { status: "ok", message: "Drawing removed." };
}

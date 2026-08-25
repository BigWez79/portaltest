"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { notifyAccessChange } from "@/lib/notify";
import { resolveAccess } from "@/lib/staff";
import { FLAGS, inviteStaff, setFlag, type Flag } from "@/lib/staff-admin";

export type AdminState = { status: "idle" | "ok" | "error"; message?: string };

/**
 * Every admin action re-checks who is calling. A server action is a public
 * endpoint: the page rendering an admin control is not what stops a non-admin
 * calling it.
 */
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const access = await resolveAccess(user);
  if (!access.isAdmin) throw new Error("Not an admin");
  return { user, access };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function toggleFlag(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  let caller;
  try {
    caller = await requireAdmin();
  } catch {
    return { status: "error", message: "You are not allowed to change access." };
  }

  const email = String(formData.get("email") ?? "").toLowerCase();
  const flag = String(formData.get("flag") ?? "") as Flag;
  const value = String(formData.get("value") ?? "") === "true";

  if (!FLAGS.includes(flag)) {
    return { status: "error", message: "Unknown permission." };
  }

  // An admin removing their own admin flag is one click from nobody being able
  // to grant it back. Bootstrap admins exist for exactly this, but the honest
  // fix is not to allow the click.
  if (flag === "isAdmin" && !value && email === caller.user.email) {
    return {
      status: "error",
      message: "You cannot remove your own admin access. Ask another admin.",
    };
  }
  if (flag === "active" && !value && email === caller.user.email) {
    return { status: "error", message: "You cannot deactivate yourself." };
  }

  try {
    await setFlag(email, flag, value);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not save that change.",
    };
  }

  if (flag !== "active") {
    await notifyAccessChange(email, value ? [flag] : [], value ? [] : [flag]);
  }

  revalidatePath("/admin");
  return { status: "ok" };
}

export async function invite(_previous: AdminState, formData: FormData): Promise<AdminState> {
  try {
    await requireAdmin();
  } catch {
    return { status: "error", message: "You are not allowed to invite people." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!EMAIL.test(email)) {
    return { status: "error", message: "That does not look like an email address." };
  }

  const result = await inviteStaff(email, fullName);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/admin");
  return { status: "ok", message: `Invitation sent to ${email}.` };
}

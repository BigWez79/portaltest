"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import {
  BUSINESS_TYPES,
  checkLogo,
  normaliseAccountNo,
  normaliseSortCode,
  saveProfile,
} from "@/lib/profile";
import { resolveAccess } from "@/lib/staff";

export type ProfileState = { status: "idle" | "ok" | "error"; message?: string };

/**
 * My Profile has no flag — every active staff member gets it (CLAUDE.md rule
 * 10) — so the check here is an active staff row and nothing more. It is still
 * a check: a server action is a public endpoint, and rendering the form is not
 * what stops a signed-in stranger posting to it (rule 5).
 */
async function requireStaff() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const access = await resolveAccess(user);
  if (!access.isStaff && !access.isBootstrapAdmin) throw new Error("Not staff");
  return access;
}

const text = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

export async function updateProfile(
  _previous: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  let access;
  try {
    access = await requireStaff();
  } catch {
    return { status: "error", message: "You are not allowed to change this profile." };
  }

  const businessType = text(formData.get("businessType"));
  if (businessType && !BUSINESS_TYPES.includes(businessType as (typeof BUSINESS_TYPES)[number])) {
    return { status: "error", message: "Choose a business type from the list." };
  }

  const vatRegistered = String(formData.get("vatRegistered") ?? "") === "yes";
  const vatNumber = text(formData.get("vatNumber"));

  // The constraint refuses a VAT number on an unregistered business, and an
  // invoice printing one that should not be there is a correction letter.
  if (!vatRegistered && vatNumber) {
    return {
      status: "error",
      message: "Remove the VAT number, or tick that the business is VAT registered.",
    };
  }

  const sortRaw = String(formData.get("sortCode") ?? "");
  const accRaw = String(formData.get("accountNo") ?? "");
  const sortCode = sortRaw.trim() ? normaliseSortCode(sortRaw) : null;
  const accountNo = accRaw.trim() ? normaliseAccountNo(accRaw) : null;

  if (sortCode !== null && sortCode.length !== 6) {
    return { status: "error", message: "A sort code is six digits." };
  }
  if (accountNo !== null && accountNo.length !== 8) {
    return { status: "error", message: "An account number is eight digits." };
  }

  // The form posts the logo as a data URL in a hidden field, which means the
  // value arriving here is whatever somebody chose to post — the file picker
  // and the canvas are a convenience, not a gate (rule 5).
  const logo = String(formData.get("logo") ?? "").trim() || null;
  const logoProblem = checkLogo(logo);
  if (logoProblem) return { status: "error", message: logoProblem };

  const terms = Number(formData.get("paymentTermsDays"));
  if (!Number.isFinite(terms) || terms < 0 || terms > 365) {
    return { status: "error", message: "Payment terms are a number of days, up to 365." };
  }

  const ok = await saveProfile(access.email, {
    businessName: text(formData.get("businessName")),
    businessType,
    businessAddress: text(formData.get("businessAddress")),
    companyNumber: text(formData.get("companyNumber")),
    vatRegistered,
    vatNumber,
    accountName: text(formData.get("accountName")),
    sortCode,
    accountNo,
    issuerPrefix: text(formData.get("issuerPrefix"))?.toUpperCase() ?? null,
    paymentTermsDays: terms,
    contactEmail: text(formData.get("contactEmail")),
    contactPhone: text(formData.get("contactPhone")),
    tagline: text(formData.get("tagline")),
    logo,
  });

  if (!ok) return { status: "error", message: "That could not be saved." };

  revalidatePath("/profile");
  revalidatePath("/invoices");
  return { status: "ok", message: "Profile saved." };
}

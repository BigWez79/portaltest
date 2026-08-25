import "server-only";
import { resend as cfg, siteUrl } from "./env";

const APP_NAMES: Record<string, string> = {
  hasInvoices: "Invoices",
  hasTimesheet: "Timesheets",
  hasExpenses: "Expenses",
  isAdmin: "Admin",
};

/**
 * Tells a person when their access changes, through Resend.
 *
 * A no-op when RESEND_API_KEY is unset, so local work and the e2e suite send no
 * mail. Never throws into the caller: failing to send a courtesy email must not
 * fail the access change that prompted it.
 */
export async function notifyAccessChange(
  email: string,
  gained: string[],
  lost: string[],
): Promise<void> {
  if (!cfg.enabled || (gained.length === 0 && lost.length === 0)) return;

  const name = (k: string) => APP_NAMES[k] ?? k;
  const lines: string[] = [];
  if (gained.length) lines.push(`You now have access to: ${gained.map(name).join(", ")}.`);
  if (lost.length) lines.push(`Access removed: ${lost.map(name).join(", ")}.`);

  try {
    const { Resend } = await import("resend");
    const client = new Resend(cfg.apiKey);
    await client.emails.send({
      from: cfg.from,
      to: email,
      subject: "Your Power Analytix access has changed",
      text: [
        ...lines,
        "",
        `Open the portal: ${siteUrl()}`,
        "",
        "If this looks wrong, reply to this email.",
      ].join("\n"),
    });
  } catch (error) {
    console.error(
      "[notify] could not send access-change email",
      error instanceof Error ? error.message : error,
    );
  }
}

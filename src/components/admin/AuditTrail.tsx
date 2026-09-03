import type { AuditEntry, AuditGroup } from "@/lib/staff-audit";

/**
 * What has been changed, and by whom. One panel per person, most recently
 * changed first.
 *
 * A server component: the trail is read through the admin RLS policy on the
 * request, and nothing here is interactive, so none of it needs to reach a
 * browser as anything but markup.
 */

// Fixed to the office's clock rather than the server's. Vercel runs in UTC and
// a person reading "17:30" wants the time they made the change, not the time a
// data centre recorded it.
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});

function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.valueOf()) ? "an unrecorded time" : WHEN.format(at);
}

function what(entry: AuditEntry): string {
  if (entry.kind === "added") return "Added to the staff list";
  return entry.changes.map((c) => c.text).join(", ");
}

export function AuditTrail({ groups }: { groups: AuditGroup[] }) {
  if (groups.length === 0) {
    return <p className="empty">No access has been changed yet.</p>;
  }

  return (
    <ul className="audit-people" data-testid="audit-trail">
      {groups.map((group) => (
        <li className="audit-person" key={group.email} data-testid={`audit-${group.email}`}>
          <p className="audit-who">
            <span className="person-name">{group.name ?? group.email}</span>
            <span className="person-email">{group.email}</span>
          </p>
          <ul className="audit-entries">
            {group.entries.map((entry) => (
              <li key={entry.id} data-testid="audit-entry">
                <span
                  className={`audit-what ${
                    entry.kind === "added" || entry.changes.some((c) => c.granted)
                      ? "granted"
                      : "removed"
                  }`}
                >
                  {what(entry)}
                </span>
                <span className="audit-when">
                  {/* Null when nothing recorded an account: the one-off import
                      runs as the service role, which has no auth.uid(). */}
                  by {entry.byName ?? "unknown"} · {when(entry.at)}
                </span>
              </li>
            ))}
          </ul>
          {group.more > 0 ? (
            <p className="audit-more">
              and {group.more} earlier {group.more === 1 ? "change" : "changes"}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

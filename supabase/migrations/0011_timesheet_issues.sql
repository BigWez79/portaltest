-- 0011_timesheet_issues.sql
-- Which timesheet periods have already been billed.
--
-- Without this, "Issue invoice" is a button somebody can press twice, and the
-- second press raises a second invoice for work that has already been billed.
-- Nothing on either screen would say so: the timesheet looks the same, and the
-- invoice list just has two invoices in it with different numbers.
--
-- A row here is the record that a period became an invoice. It is a table
-- rather than a column on the lock because the two are different facts — a
-- closed month says "these hours are final", an issued month says "and this is
-- the document we sent for them". A month can be closed and never billed.

create table if not exists public.timesheet_issues (
  staff_email  citext      not null,
  claim_month  text        not null,
  invoice_id   uuid        not null references public.invoices(id) on delete cascade,
  issued_at    timestamptz not null default now(),

  primary key (staff_email, claim_month),

  constraint timesheet_issues_month_shape check (claim_month ~ '^[0-9]{4}-[0-9]{2}$')
);

-- ON DELETE CASCADE, deliberately. If the invoice is deleted the period is no
-- longer billed, and the record saying it was would stop it ever being billed
-- again — a row pointing at a document nobody can open.

comment on table public.timesheet_issues is
  'One row per timesheet period that has been turned into an invoice.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.timesheet_issues enable row level security;

drop policy if exists "read own issues" on public.timesheet_issues;
create policy "read own issues" on public.timesheet_issues
  for select using (staff_email = public.current_staff_email());

drop policy if exists "admins read every issue" on public.timesheet_issues;
create policy "admins read every issue" on public.timesheet_issues
  for select using (public.is_admin());

drop policy if exists "record own issue" on public.timesheet_issues;
create policy "record own issue" on public.timesheet_issues
  for insert with check (staff_email = public.current_staff_email());

-- No update policy: an issue is a fact about something that happened. If it was
-- wrong, the invoice is deleted and the cascade takes this with it.
drop policy if exists "remove own issue" on public.timesheet_issues;
create policy "remove own issue" on public.timesheet_issues
  for delete using (staff_email = public.current_staff_email());

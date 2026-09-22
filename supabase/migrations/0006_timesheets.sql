-- 0006_timesheets.sql
-- Timesheets: hours logged against a day, and the month lock that follows
-- from billing them.
--
-- The largest single file on the live suite and the one people open daily.
--
-- THE POLICY, unchanged (CLAUDE.md rule 11): a person reads their own entries,
-- an active admin reads everybody's. Postgres decides it against the caller's
-- JWT rather than the application remembering to filter — the live page filters
-- on `StaffEmail eq <you>` in the browser.
--
-- A DAY IS SEVERAL ROWS, NOT ONE. The live page writes one item per activity
-- and a day may hold a meeting, some project work and an hour of admin. Editing
-- a day there means creating the new rows first and then deleting the old ones,
-- "so nothing is lost on a failure" — which is a transaction written by hand
-- because SharePoint has none. Here that is one statement inside one
-- transaction, and the comment in the live file stops being a warning.

create table if not exists public.timesheet_entries (
  id            uuid primary key default gen_random_uuid(),
  staff_email   citext      not null,
  staff_name    text,
  entry_date    date        not null,
  -- Kept as text rather than an enum: the live list adds a category whenever
  -- somebody needs one, and a migration per category is the wrong trade.
  activity_type text        not null,
  project       text,
  hours_worked  numeric(5,2) not null,
  work_description text,
  -- 'YYYY-MM', derived on write. Every view in the app groups by month, and a
  -- generated column keeps it honest without the application remembering.
  claim_month   text        generated always as (to_char(entry_date, 'YYYY-MM')) stored,
  submitted_on  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A day has 24 hours in it and nobody works a negative one. The live page
  -- has no limit at all, so a slipped decimal point logs 800 hours and the
  -- month's total silently becomes nonsense.
  constraint timesheet_hours_sane check (hours_worked > 0 and hours_worked <= 24),
  constraint timesheet_activity_named check (length(btrim(activity_type)) > 0)
);

create index if not exists timesheet_staff_month_idx
  on public.timesheet_entries (staff_email, claim_month, entry_date);

drop trigger if exists timesheet_touch_updated_at on public.timesheet_entries;
create trigger timesheet_touch_updated_at
  before update on public.timesheet_entries
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Locking a month
-- ---------------------------------------------------------------------------
-- The live page locks a month when it bills it, and warns that the lock record
-- can fail after the invoice has gone out — leaving a billed month still open
-- to editing. One row per person per month: the lock exists or it does not, and
-- the policies below read it rather than trusting a flag on every entry.

create table if not exists public.timesheet_month_locks (
  staff_email citext      not null,
  claim_month text        not null,
  locked_at   timestamptz not null default now(),
  -- Set when the month was locked by billing it, so the lock can say why.
  invoice_id  uuid references public.invoices (id) on delete set null,
  primary key (staff_email, claim_month)
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.timesheet_entries    enable row level security;
alter table public.timesheet_month_locks enable row level security;

drop policy if exists "read own entries" on public.timesheet_entries;
create policy "read own entries" on public.timesheet_entries
  for select using (staff_email = public.current_staff_email());

drop policy if exists "admins read every entry" on public.timesheet_entries;
create policy "admins read every entry" on public.timesheet_entries
  for select using (public.is_admin());

-- Writes: your own, and only while the month is open. As with expenses there is
-- no admin write policy — an admin reading everybody's hours is not an admin
-- editing them, and widening that is a decision rather than a convenience.
drop policy if exists "log own hours" on public.timesheet_entries;
create policy "log own hours" on public.timesheet_entries
  for insert with check (
    staff_email = public.current_staff_email()
    and not exists (
      select 1 from public.timesheet_month_locks l
      where l.staff_email = timesheet_entries.staff_email
        and l.claim_month = to_char(timesheet_entries.entry_date, 'YYYY-MM')
    )
  );

drop policy if exists "change own open hours" on public.timesheet_entries;
create policy "change own open hours" on public.timesheet_entries
  for update
  using (
    staff_email = public.current_staff_email()
    and not exists (
      select 1 from public.timesheet_month_locks l
      where l.staff_email = timesheet_entries.staff_email
        and l.claim_month = timesheet_entries.claim_month
    )
  )
  with check (staff_email = public.current_staff_email());

drop policy if exists "remove own open hours" on public.timesheet_entries;
create policy "remove own open hours" on public.timesheet_entries
  for delete
  using (
    staff_email = public.current_staff_email()
    and not exists (
      select 1 from public.timesheet_month_locks l
      where l.staff_email = timesheet_entries.staff_email
        and l.claim_month = timesheet_entries.claim_month
    )
  );

drop policy if exists "read own month locks" on public.timesheet_month_locks;
create policy "read own month locks" on public.timesheet_month_locks
  for select using (staff_email = public.current_staff_email() or public.is_admin());

drop policy if exists "lock own month" on public.timesheet_month_locks;
create policy "lock own month" on public.timesheet_month_locks
  for insert with check (staff_email = public.current_staff_email());

-- No delete policy. Unlocking a billed month is a conversation with whoever
-- raised the invoice, not a button.

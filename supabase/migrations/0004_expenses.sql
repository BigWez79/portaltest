-- 0004_expenses.sql
-- Expenses: the first ported app that writes.
--
-- Margin and Tax Breakdown are calculators — they read nothing and store
-- nothing, which is why they went first. This is the first table a ported app
-- owns, so it is also where the shape for Timesheets and Invoices gets decided.
--
-- Numbered 0004, not 0003: the Monthly Overview branch already claims 0003 and
-- is not merged yet. Two files with the same number is a merge conflict nobody
-- needs, and migration order is the one thing that cannot be resolved by
-- keeping both sides.
--
-- THE POLICY, unchanged from CLAUDE.md rule 11: a person reads their own
-- records, an active admin reads everybody's. Decided by Postgres against the
-- caller's own JWT, not by the application remembering to filter. The live
-- expenses.html filters client-side on `StaffEmail eq <you>` and its own
-- comments admit a server-side filter there could be trimmed to empty — which
-- is exactly the class of mistake row level security removes.

-- ---------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------

-- The staff row's email for the current JWT, or null when the caller has no
-- row. Security definer so the lookup itself is not subject to the policies
-- below — otherwise every policy that calls this recurses into staff's own RLS.
create or replace function public.current_staff_email()
returns citext
language sql
security definer
stable
set search_path = public
as $$
  select email from public.staff where user_id = auth.uid() and active limit 1;
$$;

revoke all on function public.current_staff_email() from public;
grant execute on function public.current_staff_email() to authenticated;

-- ---------------------------------------------------------------------------
-- The claims themselves
-- ---------------------------------------------------------------------------

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  staff_email   citext      not null,
  staff_name    text,
  expense_date  date        not null,
  -- Mileage is calculated; everything else is typed in. Kept as text rather
  -- than an enum so adding a category is a settings change, not a migration.
  expense_type  text        not null,
  miles         numeric(10,1),
  from_location text,
  to_location   text,
  amount        numeric(10,2) not null,
  reason        text,
  receipt_held  boolean     not null default false,
  notes         text,
  -- 'YYYY-MM', derived from expense_date on write. Denormalised on purpose:
  -- every list view in the app groups by claim month, and a generated column
  -- keeps it honest without the application having to remember.
  claim_month   text        generated always as (to_char(expense_date, 'YYYY-MM')) stored,
  submitted_on  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint expenses_amount_sane check (amount >= 0),
  constraint expenses_miles_sane  check (miles is null or miles > 0),
  -- Mileage carries miles; nothing else does. Catches a category change that
  -- forgets to clear the mileage fields.
  constraint expenses_mileage_shape check (
    (expense_type = 'Mileage' and miles is not null)
    or (expense_type <> 'Mileage' and miles is null)
  )
);

create index if not exists expenses_staff_month_idx
  on public.expenses (staff_email, claim_month, expense_date desc);

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Locking a month
-- ---------------------------------------------------------------------------
-- The live app PATCHes a MonthLocked flag onto every item in the month, which
-- means a half-finished lock leaves some rows locked and some not. One row per
-- person per month instead: the lock either exists or it does not.

create table if not exists public.expense_claim_locks (
  staff_email citext      not null,
  claim_month text        not null,
  locked_at   timestamptz not null default now(),
  locked_by   uuid,
  primary key (staff_email, claim_month)
);

-- ---------------------------------------------------------------------------
-- Mileage rates
-- ---------------------------------------------------------------------------
-- One row, enforced. The live version keeps rates in a shared settings list and
-- finds them with `Title == 'MileageRates'` or, failing that, whatever row came
-- back first — which silently reads the wrong settings when the list grows.

create table if not exists public.expense_settings (
  id        boolean primary key default true,
  rate1     numeric(6,3) not null default 0.55,
  threshold integer      not null default 10000,
  rate2     numeric(6,3) not null default 0.25,
  updated_at timestamptz not null default now(),

  constraint expense_settings_singleton check (id),
  constraint expense_settings_rates_sane check (rate1 >= 0 and rate2 >= 0 and threshold >= 0)
);

insert into public.expense_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists expense_settings_touch_updated_at on public.expense_settings;
create trigger expense_settings_touch_updated_at
  before update on public.expense_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.expenses            enable row level security;
alter table public.expense_claim_locks enable row level security;
alter table public.expense_settings    enable row level security;

-- Reads: your own, or everybody's if you are an active admin.
drop policy if exists "read own expenses" on public.expenses;
create policy "read own expenses" on public.expenses
  for select using (staff_email = public.current_staff_email());

drop policy if exists "admins read every expense" on public.expenses;
create policy "admins read every expense" on public.expenses
  for select using (public.is_admin());

-- Writes: your own only, and only while the month is open. An admin reading
-- everybody's claims is not an admin editing them — there is no admin write
-- policy here on purpose. Widening that is a decision, not a convenience.
drop policy if exists "add own expenses" on public.expenses;
create policy "add own expenses" on public.expenses
  for insert with check (
    staff_email = public.current_staff_email()
    and not exists (
      select 1 from public.expense_claim_locks l
      where l.staff_email = expenses.staff_email
        and l.claim_month = to_char(expenses.expense_date, 'YYYY-MM')
    )
  );

drop policy if exists "change own expenses" on public.expenses;
create policy "change own expenses" on public.expenses
  for update
  using (
    staff_email = public.current_staff_email()
    and not exists (
      select 1 from public.expense_claim_locks l
      where l.staff_email = expenses.staff_email and l.claim_month = expenses.claim_month
    )
  )
  with check (staff_email = public.current_staff_email());

drop policy if exists "remove own expenses" on public.expenses;
create policy "remove own expenses" on public.expenses
  for delete
  using (
    staff_email = public.current_staff_email()
    and not exists (
      select 1 from public.expense_claim_locks l
      where l.staff_email = expenses.staff_email and l.claim_month = expenses.claim_month
    )
  );

-- Locks: you can see and set your own; an admin can see everybody's. Nobody
-- unlocks from the application — that is a conversation with whoever does the
-- payroll, so there is no delete policy.
drop policy if exists "read own locks" on public.expense_claim_locks;
create policy "read own locks" on public.expense_claim_locks
  for select using (staff_email = public.current_staff_email() or public.is_admin());

drop policy if exists "lock own month" on public.expense_claim_locks;
create policy "lock own month" on public.expense_claim_locks
  for insert with check (staff_email = public.current_staff_email());

-- Rates: everybody signed in needs them to see what a mile is worth; only an
-- admin changes them.
drop policy if exists "read rates" on public.expense_settings;
create policy "read rates" on public.expense_settings
  for select using (public.current_staff_email() is not null);

drop policy if exists "admins change rates" on public.expense_settings;
create policy "admins change rates" on public.expense_settings
  for update using (public.is_admin()) with check (public.is_admin());

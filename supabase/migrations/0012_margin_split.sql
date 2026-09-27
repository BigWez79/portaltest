-- 0012_margin_split.sql
-- Margin Split: jobs feed a shared pot, contractors draw from it.
--
-- WRITTEN UNATTENDED, NOT APPLIED. A person applies this while watching
-- (BLOCKED.md, "Applying a migration"). Until then /admin/margin-split reads
-- nothing in a deployed environment; the suite runs it on the fixture store.
--
-- New records made here, not an app's records moved off SharePoint. Not the
-- Margin & Profit Split calculator behind has_margin, and not a tile — no flag
-- column, because it is part of the admin screen.
--
-- THE POLICY: rule 11 is "a person reads their own records; an active admin
-- reads everybody's". These rows belong to no staff member — a contractor is a
-- name, not a sign-in — so there is no "own" half, and what is left is an
-- active admin, for reading and for writing. Nobody else sees a row.
--
-- MONEY IS INTEGERS. Pence in bigint, percentages in basis points (12.5% =
-- 1250). The application does the arithmetic in the same units, so the pot and
-- the allocations reconcile to the penny and a numeric column never rounds a
-- figure behind anybody's back.

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

create table if not exists public.margin_split_jobs (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  job_date    date        not null,
  value_pence bigint      not null,
  margin_bp   integer     not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint margin_split_jobs_name_present check (length(trim(name)) > 0),
  constraint margin_split_jobs_value_sane   check (value_pence >= 0),
  constraint margin_split_jobs_margin_sane  check (margin_bp between 0 and 10000)
);

drop trigger if exists margin_split_jobs_touch_updated_at on public.margin_split_jobs;
create trigger margin_split_jobs_touch_updated_at
  before update on public.margin_split_jobs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Contractors
-- ---------------------------------------------------------------------------
-- position is the listing order, and the order ties are broken in when the pot
-- is split. Unique, but deferred: renumbering a list swaps positions, and an
-- immediate check would refuse the first half of every swap.

create table if not exists public.margin_split_contractors (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null,
  share_bp   integer     not null,
  position   integer     not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint margin_split_contractors_name_present check (length(trim(name)) > 0),
  constraint margin_split_contractors_share_sane   check (share_bp between 0 and 10000),
  constraint margin_split_contractors_position_unique unique (position)
    deferrable initially deferred
);

drop trigger if exists margin_split_contractors_touch_updated_at on public.margin_split_contractors;
create trigger margin_split_contractors_touch_updated_at
  before update on public.margin_split_contractors
  for each row execute function public.touch_updated_at();

-- Shares total exactly 10000, checked at commit. Deferred because no single
-- row change can keep the total right — moving 1% from one contractor to
-- another is two updates, and the table is wrong between them. Security
-- definer so the sum is over every row, not only the rows the caller's
-- policies let it see.
create or replace function public.margin_split_check_shares()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
  n     bigint;
begin
  select coalesce(sum(share_bp), 0), count(*) into total, n from public.margin_split_contractors;
  if n > 0 and total <> 10000 then
    raise exception 'contractor shares total % basis points, not 10000', total
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists margin_split_contractors_shares_total on public.margin_split_contractors;
create constraint trigger margin_split_contractors_shares_total
  after insert or update or delete on public.margin_split_contractors
  deferrable initially deferred
  for each row execute function public.margin_split_check_shares();

-- Three to start, equal as near as basis points allow. Named placeholders: an
-- admin renames them on the screen. Only into an empty table, so running this
-- twice does not add three more.
insert into public.margin_split_contractors (name, share_bp, position)
select v.name, v.share_bp, v.position
  from (values ('Contractor A', 3334, 1),
               ('Contractor B', 3333, 2),
               ('Contractor C', 3333, 3)) as v(name, share_bp, position)
 where not exists (select 1 from public.margin_split_contractors);

-- ---------------------------------------------------------------------------
-- Drawings
-- ---------------------------------------------------------------------------
-- A drawing keeps its contractor: restrict, not cascade. Removing a contractor
-- with money drawn against them would make the pot remaining wrong silently.

create table if not exists public.margin_split_drawings (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid        not null references public.margin_split_contractors (id) on delete restrict,
  draw_date     date        not null,
  amount_pence  bigint      not null,
  method        text        not null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint margin_split_drawings_amount_sane check (amount_pence > 0),
  constraint margin_split_drawings_method_known check (method in ('cash', 'bank_transfer'))
);

create index if not exists margin_split_drawings_contractor_idx
  on public.margin_split_drawings (contractor_id, draw_date);

drop trigger if exists margin_split_drawings_touch_updated_at on public.margin_split_drawings;
create trigger margin_split_drawings_touch_updated_at
  before update on public.margin_split_drawings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Saving the contractor list as one change
-- ---------------------------------------------------------------------------
-- The screen saves every contractor at once, because shares only make sense as
-- a set. Over PostgREST that would be one request per row with no transaction
-- around them; this is one call, one transaction, and the deferred check above
-- runs once at the end of it.
--
-- Security invoker (the default), so the policies below still decide: a
-- non-admin calling this updates nothing and inserts nothing. The is_admin()
-- check at the top only makes that refusal say what it is.

create or replace function public.save_margin_split_contractors(list jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
  pos  integer := 0;
begin
  if not public.is_admin() then
    raise exception 'only an active admin can change the margin split'
      using errcode = 'insufficient_privilege';
  end if;

  -- There is no removing a contractor from this screen: drawings point at them.
  if exists (
    select 1 from public.margin_split_contractors c
     where c.id::text not in (
       select e ->> 'id' from jsonb_array_elements(list) e where e ->> 'id' is not null
     )
  ) then
    raise exception 'every existing contractor must be in the list';
  end if;

  for item in select * from jsonb_array_elements(list) loop
    pos := pos + 1;
    if item ->> 'id' is null then
      insert into public.margin_split_contractors (name, share_bp, position)
      values (item ->> 'name', (item ->> 'share_bp')::integer, pos);
    else
      update public.margin_split_contractors
         set name = item ->> 'name',
             share_bp = (item ->> 'share_bp')::integer,
             position = pos
       where id = (item ->> 'id')::uuid;
      if not found then
        raise exception 'no contractor %', item ->> 'id';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.save_margin_split_contractors(jsonb) from public;
grant execute on function public.save_margin_split_contractors(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security — an active admin, and nobody else
-- ---------------------------------------------------------------------------
-- No anon policy on any of these, and none is to be added (BLOCKED.md).

alter table public.margin_split_jobs        enable row level security;
alter table public.margin_split_contractors enable row level security;
alter table public.margin_split_drawings    enable row level security;

drop policy if exists "admins read jobs" on public.margin_split_jobs;
create policy "admins read jobs" on public.margin_split_jobs
  for select using (public.is_admin());
drop policy if exists "admins add jobs" on public.margin_split_jobs;
create policy "admins add jobs" on public.margin_split_jobs
  for insert with check (public.is_admin());
drop policy if exists "admins change jobs" on public.margin_split_jobs;
create policy "admins change jobs" on public.margin_split_jobs
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins remove jobs" on public.margin_split_jobs;
create policy "admins remove jobs" on public.margin_split_jobs
  for delete using (public.is_admin());

-- Contractors: no delete policy. Drawings point at them, and the screen has no
-- way to remove one — deciding what happens to money already drawn is a
-- person's call, not a button's.
drop policy if exists "admins read contractors" on public.margin_split_contractors;
create policy "admins read contractors" on public.margin_split_contractors
  for select using (public.is_admin());
drop policy if exists "admins add contractors" on public.margin_split_contractors;
create policy "admins add contractors" on public.margin_split_contractors
  for insert with check (public.is_admin());
drop policy if exists "admins change contractors" on public.margin_split_contractors;
create policy "admins change contractors" on public.margin_split_contractors
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins read drawings" on public.margin_split_drawings;
create policy "admins read drawings" on public.margin_split_drawings
  for select using (public.is_admin());
drop policy if exists "admins add drawings" on public.margin_split_drawings;
create policy "admins add drawings" on public.margin_split_drawings
  for insert with check (public.is_admin());
drop policy if exists "admins change drawings" on public.margin_split_drawings;
create policy "admins change drawings" on public.margin_split_drawings
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins remove drawings" on public.margin_split_drawings;
create policy "admins remove drawings" on public.margin_split_drawings
  for delete using (public.is_admin());

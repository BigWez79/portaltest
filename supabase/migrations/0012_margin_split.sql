-- 0012_margin_split.sql
-- Margin Split: jobs feed a shared pot, contractors draw from it.
--
-- New records, created here — not an app's records moved off SharePoint. Not
-- the Margin & Profit Split calculator either: that is /margin, stores nothing,
-- and is untouched.
--
-- Money is integer pence and percentages integer basis points (12.5% = 1250).
-- The pot and the split are computed by the application from these rows and
-- are never stored, so there is no total here to fall out of step.
--
-- THE POLICY, rule 11: an active admin reads and writes every row. Nobody else
-- gets a policy, so nobody else sees a row. Nothing is deletable from the
-- application — a drawing entered in error is a conversation, not a button.
--
-- NOT APPLIED. Written unattended, applied by a person (BLOCKED.md, Data).

create table if not exists public.margin_split_jobs (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (length(trim(name)) > 0),
  job_date    date        not null,
  value_pence bigint      not null check (value_pence between 0 and 1000000000),
  margin_bp   integer     not null check (margin_bp between 0 and 10000),
  created_at  timestamptz not null default now(),
  created_by  uuid        default auth.uid()
);

create table if not exists public.margin_split_contractors (
  id         uuid primary key default gen_random_uuid(),
  -- A name, not a staff sign-in: contractors never see this page.
  name       text        not null check (length(trim(name)) > 0),
  share_bp   integer     not null default 0 check (share_bp between 0 and 10000),
  -- Listing order. Ties in the largest-remainder split go to the lowest.
  position   integer     not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.margin_split_drawings (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid        not null references public.margin_split_contractors(id) on delete restrict,
  drawn_on      date        not null,
  amount_pence  bigint      not null check (amount_pence between 1 and 1000000000),
  method        text        not null check (method in ('cash', 'bank_transfer')),
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid        default auth.uid()
);

create index if not exists margin_split_drawings_contractor_idx
  on public.margin_split_drawings (contractor_id, drawn_on);

-- ---------------------------------------------------------------------------
-- Shares total exactly 10000
-- ---------------------------------------------------------------------------
-- Checked at commit, not per row: changing three shares is three updates, and
-- the total is only meaningful once all of them have landed. Security definer
-- so the sum counts every row, whatever the caller's policies let them see.

create or replace function public.margin_split_check_shares()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
begin
  select sum(share_bp) into total from public.margin_split_contractors;
  if total is not null and total <> 10000 then
    raise exception 'contractor shares total % basis points, not 10000', total
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists margin_split_shares_total on public.margin_split_contractors;
create constraint trigger margin_split_shares_total
  after insert or update or delete on public.margin_split_contractors
  deferrable initially deferred
  for each row execute function public.margin_split_check_shares();

-- Names and shares in one transaction. Security invoker: the policies below
-- decide, and the is_admin() check is only there for a clearer error.
create or replace function public.margin_split_set_shares(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = 'insufficient_privilege';
  end if;
  update public.margin_split_contractors c
     set name = r.name, share_bp = r.share_bp
    from jsonb_to_recordset(p_rows) as r(id uuid, name text, share_bp integer)
   where c.id = r.id;
end;
$$;

-- A new contractor goes last, on a 0% share, so the total is unchanged.
create or replace function public.margin_split_add_contractor(p_name text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = 'insufficient_privilege';
  end if;
  lock table public.margin_split_contractors in share row exclusive mode;
  insert into public.margin_split_contractors (name, share_bp, position)
  select p_name, 0, coalesce(max(position), 0) + 1 from public.margin_split_contractors;
end;
$$;

revoke all on function public.margin_split_set_shares(jsonb) from public;
revoke all on function public.margin_split_add_contractor(text) from public;
grant execute on function public.margin_split_set_shares(jsonb) to authenticated;
grant execute on function public.margin_split_add_contractor(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Three to start, equal shares; the spare basis point to the first listed.
-- Placeholder names — an admin renames them on the page.
-- ---------------------------------------------------------------------------

insert into public.margin_split_contractors (name, share_bp, position)
select * from (values ('Contractor A', 3334, 1), ('Contractor B', 3333, 2), ('Contractor C', 3333, 3)) v
where not exists (select 1 from public.margin_split_contractors);

-- ---------------------------------------------------------------------------
-- Row level security: an active admin, and nobody else
-- ---------------------------------------------------------------------------

alter table public.margin_split_jobs        enable row level security;
alter table public.margin_split_contractors enable row level security;
alter table public.margin_split_drawings    enable row level security;

revoke all on public.margin_split_jobs, public.margin_split_contractors, public.margin_split_drawings from anon;

drop policy if exists "admins read jobs" on public.margin_split_jobs;
create policy "admins read jobs" on public.margin_split_jobs
  for select to authenticated using (public.is_admin());
drop policy if exists "admins add jobs" on public.margin_split_jobs;
create policy "admins add jobs" on public.margin_split_jobs
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admins read contractors" on public.margin_split_contractors;
create policy "admins read contractors" on public.margin_split_contractors
  for select to authenticated using (public.is_admin());
drop policy if exists "admins add contractors" on public.margin_split_contractors;
create policy "admins add contractors" on public.margin_split_contractors
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins change contractors" on public.margin_split_contractors;
create policy "admins change contractors" on public.margin_split_contractors
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins read drawings" on public.margin_split_drawings;
create policy "admins read drawings" on public.margin_split_drawings
  for select to authenticated using (public.is_admin());
drop policy if exists "admins add drawings" on public.margin_split_drawings;
create policy "admins add drawings" on public.margin_split_drawings
  for insert to authenticated with check (public.is_admin());

-- 0001_staff.sql
-- Suite staff, and who may reach which app.
--
-- Supabase Auth is the identity. Every read below is protected by row level
-- security against the caller's own JWT, so a staff member can see their row and
-- nothing else, and an admin can see everybody — decided by Postgres, not by the
-- application remembering to filter.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

create table if not exists public.staff (
  id            uuid primary key default gen_random_uuid(),
  -- Linked when the invited person first signs in (see the trigger below).
  user_id       uuid unique references auth.users (id) on delete set null,
  email         citext      not null unique,
  full_name     text,
  active        boolean     not null default true,
  is_admin      boolean     not null default false,
  has_invoices  boolean     not null default false,
  has_timesheet boolean     not null default false,
  has_expenses  boolean     not null default false,
  has_margin    boolean     not null default false,
  has_tax_breakdown boolean not null default false,
  invited_at    timestamptz,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists staff_user_id_idx on public.staff (user_id);

-- ---------------------------------------------------------------------------
-- housekeeping
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists staff_touch_updated_at on public.staff;
create trigger staff_touch_updated_at
  before update on public.staff
  for each row execute function public.touch_updated_at();

-- An invited person exists in auth.users only once they accept. Link the two the
-- moment that happens, so the staff row stops being keyed on an address alone.
create or replace function public.link_staff_to_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff
     set user_id = new.id,
         last_seen_at = now()
   where email = new.email
     and user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_staff_to_user();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------

-- security definer, so the policies below can ask "is the caller an admin"
-- without re-entering the policy that is asking. A plain sub-select on staff
-- inside a staff policy recurses forever.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.staff
     where user_id = auth.uid()
       and active
       and is_admin
  );
$$;

alter table public.staff enable row level security;

drop policy if exists "read own row" on public.staff;
create policy "read own row" on public.staff
  for select
  using (user_id = auth.uid());

drop policy if exists "admins read every row" on public.staff;
create policy "admins read every row" on public.staff
  for select
  using (public.is_admin());

drop policy if exists "admins add staff" on public.staff;
create policy "admins add staff" on public.staff
  for insert
  with check (public.is_admin());

drop policy if exists "admins change staff" on public.staff;
create policy "admins change staff" on public.staff
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy anywhere. People who leave are deactivated; the row is the
-- only record of what they had.

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------

create table if not exists public.staff_audit (
  id          bigint generated always as identity primary key,
  staff_email citext      not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  before      jsonb,
  after       jsonb
);

create index if not exists staff_audit_email_idx on public.staff_audit (staff_email, changed_at desc);

create or replace function public.record_staff_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_audit (staff_email, changed_by, before, after)
  values (
    coalesce(new.email, old.email),
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists staff_audit_trigger on public.staff;
create trigger staff_audit_trigger
  after insert or update on public.staff
  for each row execute function public.record_staff_change();

alter table public.staff_audit enable row level security;

drop policy if exists "admins read the audit" on public.staff_audit;
create policy "admins read the audit" on public.staff_audit
  for select
  using (public.is_admin());

comment on table public.staff is
  'Suite staff and per-app access. Protected by RLS against the caller''s Supabase session. The service role is used only to invite a person and by the one-off CSV import — never to read rows for a page.';

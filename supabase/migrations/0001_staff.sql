-- 0001_staff.sql
-- The suite's staff identity and per-app access flags.
--
-- Mirrors the SharePoint "Staff" list one-for-one so the sync can be a plain
-- upsert and so a flag means the same thing in both places while Invoices,
-- Timesheets and Expenses still read SharePoint.
--
--   SharePoint field   ->  column
--   Title              ->  email
--   OfficialName       ->  official_name
--   Active             ->  active
--   IsAdmin            ->  is_admin
--   HasInvoices        ->  has_invoices
--   HasTimesheet       ->  has_timesheet
--   HasExpenses        ->  has_expenses

create extension if not exists "pgcrypto";

create table if not exists public.staff (
  id             uuid primary key default gen_random_uuid(),
  email          text        not null,
  -- Entra does not always hand back the mailbox; keep the UPN so the portal can
  -- match on either.
  upn            text,
  official_name  text,
  active         boolean     not null default false,
  is_admin       boolean     not null default false,
  has_invoices   boolean     not null default false,
  has_timesheet  boolean     not null default false,
  has_expenses   boolean     not null default false,
  -- provenance, so a row that stops arriving from SharePoint is visible
  source_item_id text,
  synced_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists staff_email_lower_idx on public.staff (lower(email));
create index if not exists staff_upn_lower_idx on public.staff (lower(upn));

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

-- Row level security on, and deliberately no policies at all.
--
-- Sign-in is Entra, not Supabase Auth, so there is no Supabase JWT to write a
-- policy against. Deny-by-default plus a service-role read on the server is the
-- honest version of that. The anon key is not used by this app and should not
-- be given one.
alter table public.staff enable row level security;

comment on table public.staff is
  'Suite staff and per-app access. RLS enabled with no policies on purpose: the portal reads this with the service role, server-side only. Do not add an anon or authenticated policy without moving sign-in to Supabase Auth first.';

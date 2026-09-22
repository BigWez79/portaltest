-- 0007_profiles.sql
-- My Profile: the business details a person invoices under.
--
-- Every active staff member has this screen — there is no flag for it
-- (CLAUDE.md rule 10), so the policy is the staff row and nothing else.
--
-- WHY IT MATTERS BEYOND ITS OWN PAGE. Invoices stamps the seller's details onto
-- every invoice it raises, so this is where those come from. Until now that
-- stamp carried only a name; with this table it carries the business name,
-- address, VAT number, company number and bank details the document needs.
--
-- ONE ROW PER PERSON, keyed by email rather than by a generated id: the row is
-- the person's profile, there is never a second one, and a primary key that
-- says so is cheaper than a unique index plus the application remembering.

create table if not exists public.profiles (
  staff_email       citext primary key,

  -- What goes on an invoice
  business_name     text,
  business_type     text,
  business_address  text,
  company_number    text,
  vat_registered    boolean     not null default false,
  vat_number        text,

  -- Where a payment lands
  account_name      text,
  sort_code         text,
  account_no        text,

  -- How invoices are numbered and when they fall due
  issuer_prefix     text,
  payment_terms_days integer    not null default 30,

  -- How to reach this person
  contact_email     citext,
  contact_phone     text,
  tagline           text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A VAT number is meaningless unless the business is registered, and an
  -- invoice printing one when it should not is a correction letter.
  constraint profiles_vat_consistent check (vat_registered or vat_number is null),
  constraint profiles_terms_sane check (payment_terms_days >= 0 and payment_terms_days <= 365),
  -- The live page accepts anything in these boxes, so a sort code arrives as
  -- "20-00-00", "200000" or "20 00 00" and the invoice prints whichever was
  -- typed. Stored as six digits; the application formats it for display.
  constraint profiles_sort_code_shape check (sort_code is null or sort_code ~ '^[0-9]{6}$'),
  constraint profiles_account_no_shape check (account_no is null or account_no ~ '^[0-9]{8}$')
);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Your own, and an active admin reads everybody's — the same policy as every
-- other table here (rule 11). Bank details are the most sensitive thing in this
-- schema, so there is deliberately no admin *write* policy: an admin reading a
-- profile to answer a question is not an admin changing where somebody's money
-- goes.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (staff_email = public.current_staff_email());

drop policy if exists "admins read every profile" on public.profiles;
create policy "admins read every profile" on public.profiles
  for select using (public.is_admin());

drop policy if exists "write own profile" on public.profiles;
create policy "write own profile" on public.profiles
  for insert with check (staff_email = public.current_staff_email());

drop policy if exists "change own profile" on public.profiles;
create policy "change own profile" on public.profiles
  for update
  using (staff_email = public.current_staff_email())
  with check (staff_email = public.current_staff_email());

-- No delete policy. A profile is not deleted when somebody leaves — their
-- invoices reference the details it holds, and those documents have to keep
-- saying what was sent.

-- 0005_invoices.sql
-- Invoices: customers, invoice headers, their lines, and the seller's details.
--
-- The heaviest port so far, and the only one that produces a document somebody
-- outside the company reads. That shapes two decisions below.
--
-- THE POLICY, as everywhere else (CLAUDE.md rule 11): a person reads their own
-- records, an active admin reads everybody's, and Postgres decides it against
-- the caller's JWT rather than the application remembering to filter.
--
-- WHO OWNS AN INVOICE. The live page stamps `SellerEmail` from the signed-in
-- account at creation and filters the list on it, so an invoice belongs to
-- whoever raised it. Kept, because changing it would change who can see what,
-- and that is not a decision a port gets to make on its own.

-- ---------------------------------------------------------------------------
-- Customers — shared, not per-seller
-- ---------------------------------------------------------------------------
-- The live customers list has no owner column and everybody picks from the same
-- dropdown. Modelled as it is rather than as it might be: giving customers an
-- owner would quietly hide half the list from somebody who has been using it
-- for a year.

create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  company_name  text        not null,
  contact_name  text,
  address1      text,
  address2      text,
  town          text,
  postcode      text,
  phone         text,
  email         citext,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint customers_named check (length(btrim(company_name)) > 0)
);

create index if not exists customers_name_idx on public.customers (lower(company_name));

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
  before update on public.customers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The invoice
-- ---------------------------------------------------------------------------
-- The seller's own details are copied onto the row rather than joined from the
-- profile. An invoice is a record of what was sent: if somebody changes their
-- business address next year, last year's invoice must still say what the
-- customer actually received. The live page does the same thing for the same
-- reason, and this is the one place denormalising is the correct answer.

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  seller_email    citext      not null,
  invoice_no      text        not null,
  issuer_prefix   text,
  invoice_seq     integer,
  customer_id     uuid        not null references public.customers (id) on delete restrict,
  invoice_date    date        not null,
  project         text,
  -- Stored as the percentage a person typed (20), not the decimal. The live
  -- page accepts either and divides by 100 when it is over 1, which means 0.2
  -- and 20 both mean 20% and 0.5 means 0.5%. One shape only here.
  tax_rate        numeric(5,2) not null default 20,
  unit_total      numeric(12,2) not null default 0,
  tax_total       numeric(12,2) not null default 0,
  invoice_total   numeric(12,2) not null default 0,
  status          text        not null default 'Draft',
  paid_date       date,

  -- Seller, as it stood when the invoice was raised.
  seller_name       text,
  seller_address    text,
  seller_vat        text,
  seller_company_no text,
  seller_bank_name  text,
  seller_sort_code  text,
  seller_account_no text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Unique per seller, not globally: two people raising INV-001 is not a
  -- collision, it is two businesses.
  constraint invoices_no_unique_per_seller unique (seller_email, invoice_no),
  constraint invoices_status_known check (status in ('Draft', 'Sent', 'Paid')),
  constraint invoices_rate_sane check (tax_rate >= 0 and tax_rate <= 100),
  constraint invoices_paid_has_date check (status <> 'Paid' or paid_date is not null)
);

create index if not exists invoices_seller_date_idx
  on public.invoices (seller_email, invoice_date desc);

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at
  before update on public.invoices
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid        not null references public.invoices (id) on delete cascade,
  item_no     text,
  description text        not null,
  qty         numeric(12,3) not null,
  unit_price  numeric(12,2) not null,
  -- Held, not derived: the rate can change after a line is entered, and what a
  -- line was charged at is a fact about that line. The application recalculates
  -- and writes these when the rate moves, exactly as the live page does.
  tax         numeric(12,2) not null default 0,
  line_total  numeric(12,2) not null default 0,
  position    integer     not null default 0,
  created_at  timestamptz not null default now(),

  constraint invoice_lines_qty_sane check (qty > 0),
  constraint invoice_lines_described check (length(btrim(description)) > 0)
);

create index if not exists invoice_lines_invoice_idx
  on public.invoice_lines (invoice_id, position, created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.customers     enable row level security;
alter table public.invoices      enable row level security;
alter table public.invoice_lines enable row level security;

-- Customers: anybody signed in reads and adds them; that is how the live list
-- behaves. Nobody deletes one — an invoice references it, and a customer who
-- stopped trading is still on last year's invoices.
drop policy if exists "staff read customers" on public.customers;
create policy "staff read customers" on public.customers
  for select using (public.current_staff_email() is not null);

drop policy if exists "staff add customers" on public.customers;
create policy "staff add customers" on public.customers
  for insert with check (public.current_staff_email() is not null);

drop policy if exists "staff change customers" on public.customers;
create policy "staff change customers" on public.customers
  for update using (public.current_staff_email() is not null)
  with check (public.current_staff_email() is not null);

-- Invoices: your own, or everybody's if you are an active admin.
drop policy if exists "read own invoices" on public.invoices;
create policy "read own invoices" on public.invoices
  for select using (seller_email = public.current_staff_email());

drop policy if exists "admins read every invoice" on public.invoices;
create policy "admins read every invoice" on public.invoices
  for select using (public.is_admin());

drop policy if exists "raise own invoices" on public.invoices;
create policy "raise own invoices" on public.invoices
  for insert with check (seller_email = public.current_staff_email());

-- A paid invoice is closed. Editing one silently changes a document somebody
-- has already been sent and may have paid against, so the policy refuses it
-- rather than the application remembering not to offer the button.
drop policy if exists "change own unpaid invoices" on public.invoices;
create policy "change own unpaid invoices" on public.invoices
  for update
  using (seller_email = public.current_staff_email() and status <> 'Paid')
  with check (seller_email = public.current_staff_email());

drop policy if exists "remove own drafts" on public.invoices;
create policy "remove own drafts" on public.invoices
  for delete using (seller_email = public.current_staff_email() and status = 'Draft');

-- Lines follow their invoice, including the paid rule.
drop policy if exists "read lines of readable invoices" on public.invoice_lines;
create policy "read lines of readable invoices" on public.invoice_lines
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and (i.seller_email = public.current_staff_email() or public.is_admin())
    )
  );

drop policy if exists "write lines of own open invoices" on public.invoice_lines;
create policy "write lines of own open invoices" on public.invoice_lines
  for all
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.seller_email = public.current_staff_email()
        and i.status <> 'Paid'
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.seller_email = public.current_staff_email()
        and i.status <> 'Paid'
    )
  );

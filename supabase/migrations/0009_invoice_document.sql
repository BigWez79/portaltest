-- 0009_invoice_document.sql
-- What the invoice document needs and 0005 did not stamp.
--
-- 0005 already copies the seller's name, address, VAT number, company number
-- and bank details onto the invoice when it is raised, for the right reason: a
-- document has to keep saying what the customer was sent, whatever the seller
-- changes about themselves afterwards. These three finish that job.

alter table public.invoices
  add column if not exists seller_tagline text,
  add column if not exists seller_logo    text,
  add column if not exists payment_terms_days integer;

comment on column public.invoices.seller_tagline is
  'The tagline as it stood when the invoice was raised; prints under the business name.';
comment on column public.invoices.seller_logo is
  'The logo as it stood when the invoice was raised; a PNG data URL, same shape as profiles.logo.';
comment on column public.invoices.payment_terms_days is
  'The terms as they stood when the invoice was raised. The due date is derived from this, never stored.';

-- WHY THE TERMS ARE STAMPED AND THE LIVE PAGE'S ARE NOT.
--
-- invoices.html works the due date out from whatever the seller's settings say
-- *right now* — `dueDateOf` reads `seller().terms` at render time. So changing
-- your payment terms from 14 days to 30 silently moves the due date on every
-- invoice you have ever raised, and an invoice that was three days overdue this
-- morning is not overdue this afternoon. Nothing was sent to the customer that
-- says so.
--
-- Stamping it means the due date on the screen is the due date on the paper.
-- The cost is that correcting a genuine mistake in your terms needs the invoice
-- editing too, which is the right way round: the document is the record.
alter table public.invoices
  drop constraint if exists invoices_terms_sane;
alter table public.invoices
  add constraint invoices_terms_sane
  check (payment_terms_days is null or (payment_terms_days >= 0 and payment_terms_days <= 365));

alter table public.invoices
  drop constraint if exists invoices_logo_size;
alter table public.invoices
  add constraint invoices_logo_size
  check (seller_logo is null or (length(seller_logo) <= 150000 and seller_logo like 'data:image/png;base64,%'));

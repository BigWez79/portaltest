-- 0008_profile_logo.sql
-- The logo a person's invoices print.
--
-- WHY THIS IS A SEPARATE MIGRATION. 0007 is written but not yet applied, so
-- this could have been folded into it. It is not, because the two are about
-- different things: 0007 is the profile, this is one column that carries a
-- picture, and a column holding up to 120KB of base64 deserves to be findable
-- rather than buried in the middle of a table definition somebody is reading
-- for its bank details.

alter table public.profiles
  add column if not exists logo text;

comment on column public.profiles.logo is
  'Data URL for the invoice header logo: a PNG resized to 300px wide in the browser. Null means no logo.';

-- THE CHECK IS THE POINT. The browser resizes to 300px wide and refuses
-- anything still over 120,000 characters after that, which is the right place
-- to refuse it — the person can go and find a simpler image. But the browser is
-- not what protects the table: a server action is a public endpoint (rule 5),
-- and without this a crafted post puts a 40MB string in a row that every
-- invoice read then drags back out.
--
-- 150,000 rather than 120,000 deliberately. The browser's limit is the one a
-- person meets and it comes with an explanation; this one is a backstop, and a
-- backstop sitting exactly on the real limit turns every rounding difference
-- between two base64 encoders into a failed save with no explanation at all.
alter table public.profiles
  drop constraint if exists profiles_logo_size;
alter table public.profiles
  add constraint profiles_logo_size
  check (logo is null or (length(logo) <= 150000 and logo like 'data:image/png;base64,%'));

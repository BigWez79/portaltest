-- 0010_day_rate.sql
-- What a day of work is worth, so a timesheet can become an invoice.
--
-- WHY IT LIVES ON THE PROFILE. The live suite keeps a copy of the profile
-- inside timesheet.html — its own Profile tab, its own save, its own logo
-- upload — because each page was a separate file with no way to share one. Here
-- My Profile is the place a person's details live (CLAUDE.md rule 10), and a
-- second copy would be two answers to "what do you charge" with nothing saying
-- which one an invoice used.
--
-- Timesheets still offers "Save day rate" on its own screen, because that is
-- where somebody is standing when they think about it. It writes this column.

alter table public.profiles
  add column if not exists day_rate numeric(10, 2);

comment on column public.profiles.day_rate is
  'What one day is invoiced at, in pounds. Null means timesheets cannot raise an invoice yet.';

-- Not a default. Zero is a real answer that means free, and a default of any
-- other number would put a figure somebody never agreed to onto an invoice.
-- Null is "not set", and the screen says so rather than guessing.
alter table public.profiles
  drop constraint if exists profiles_day_rate_sane;
alter table public.profiles
  add constraint profiles_day_rate_sane
  check (day_rate is null or (day_rate >= 0 and day_rate <= 100000));

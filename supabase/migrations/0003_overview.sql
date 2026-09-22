-- 0003_overview.sql
-- Monthly Overview's access flag.
--
-- The portal carried seven tiles and docs/PORTING-APPS.md lists nine apps; this
-- is the column behind the eighth. The page itself has not been ported — the
-- route shows the same placeholder the other unported apps do — but the tile,
-- the route and the admin toggle are worthless without somewhere to record who
-- may open it.
--
-- Default false, like every other flag: a new column must not hand an app to
-- everybody already on the list. Access is granted one person at a time on the
-- admin screen, which writes an audit row for each grant.
--
-- No new policy. `staff` already has row level security and the four policies in
-- 0001 cover every column in the table — "read own row", "admins read every
-- row", "admins add staff", "admins change staff". A per-column policy would be
-- a second place access is decided, and there is meant to be one.

alter table public.staff
  add column if not exists has_overview boolean not null default false;

-- 0003_overview_flag.sql
-- Monthly Overview's access flag.
--
-- docs/PORTING-APPS.md lists nine apps and the portal carried seven. Monthly
-- Overview had no tile, no route and no column — the gap between the agreed
-- plan (all nine move, 25 August) and the repository, not a new decision.
--
-- The route is the guarded placeholder every unported app has. Porting the page
-- itself is a separate task, and it runs into the "staff names versus staff
-- records" question in docs/PORTING-APPS.md, which is not settled.
--
-- Nothing else changes: no policy moves, because access to a column of `staff`
-- is already decided by the policies 0001 put on the table. A person reads their
-- own row and an active admin reads everybody's, and that covers this column on
-- the day it exists.
--
-- Default false, like every other flag: adding a column must grant nobody
-- anything. An admin turns it on per person on the staff screen, and the audit
-- trigger records that they did.

alter table public.staff
  add column if not exists has_overview boolean not null default false;

comment on column public.staff.has_overview is
  'May open Monthly Overview. Granted per person on the staff screen; never by this migration.';

-- 0002_signin_rate_limit.sql
-- A ledger of sign-in link requests, and the decision to send one.
--
-- `requestMagicLink` will otherwise send a link every time the button is
-- pressed. Supabase Auth has limits of its own, but nothing in this app stops
-- somebody pasting an address and holding down enter: it costs them nothing and
-- it fills a colleague's inbox.
--
-- The limit is a table rather than a counter in memory because the portal is a
-- serverless deployment. A redeploy, a scale-out or a cold start would each
-- reset an in-process map, which is the same as having no limit at all.
--
-- Nothing reads this table directly. Access goes through
-- `consume_signin_attempt`, a security definer function: the caller asking for
-- a link is signed out, so it holds the `anon` role, and the alternative would
-- be an insert policy granting anonymous writes to a table. The service role is
-- not an option either — CLAUDE.md allows it exactly twice, and neither is this.

create table if not exists public.signin_attempts (
  id         bigint generated always as identity primary key,
  email      citext      not null,
  -- Null when the request arrived with no forwarded-for header to trust; the
  -- per-address limit still applies.
  ip         inet,
  -- What was decided. A refused attempt is recorded but does not count towards
  -- either window, so a burst costs the person one window rather than compounding.
  allowed    boolean     not null,
  created_at timestamptz not null default now()
);

create index if not exists signin_attempts_email_idx
  on public.signin_attempts (email, created_at desc);
create index if not exists signin_attempts_ip_idx
  on public.signin_attempts (ip, created_at desc);
create index if not exists signin_attempts_created_at_idx
  on public.signin_attempts (created_at);

-- ---------------------------------------------------------------------------
-- the limit
-- ---------------------------------------------------------------------------

-- The numbers below are mirrored in src/lib/rate-limit.ts, which is what the
-- e2e suite exercises — the suite reaches no Supabase project. Change both.
--
--   per address:  5 in 60 seconds
--   per IP:      20 in 15 minutes
--
-- The per-IP window is the looser of the two on purpose. Staff behind one office
-- NAT share an address, and a refusal here is silent: the person is told a link
-- is on its way whatever happens, because a different answer for a limited
-- address, an unknown address and a real one turns the form into a directory.
create or replace function public.consume_signin_attempt(
  p_email text,
  p_ip    text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   citext := lower(trim(p_email));
  v_ip      inet;
  v_allowed boolean;
begin
  if v_email is null or v_email = '' then
    return false;
  end if;

  -- A malformed forwarded-for header must not take the sign-in form down with
  -- it. No IP means the per-address limit alone.
  begin
    v_ip := nullif(trim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- Two requests for one address arriving together would both read a count of
  -- four and both be allowed. The lock is per address and held to the end of
  -- the statement's transaction, so they queue instead.
  perform pg_advisory_xact_lock(hashtext(v_email::text)::bigint);

  -- Housekeeping, done here because there is no scheduler in this project.
  -- Nothing older than a day can affect either window.
  delete from public.signin_attempts where created_at < now() - interval '1 day';

  select
    (
      select count(*) from public.signin_attempts
       where allowed
         and email = v_email
         and created_at > now() - interval '60 seconds'
    ) < 5
    and (
      v_ip is null or (
        select count(*) from public.signin_attempts
         where allowed
           and ip = v_ip
           and created_at > now() - interval '15 minutes'
      ) < 20
    )
  into v_allowed;

  insert into public.signin_attempts (email, ip, allowed)
  values (v_email, v_ip, v_allowed);

  return v_allowed;
end;
$$;

-- ---------------------------------------------------------------------------
-- who may touch any of this
-- ---------------------------------------------------------------------------

-- RLS on with no policy at all: the definer function is the only way in, and
-- that is narrower than the read policy every other table here carries. This is
-- a ledger of requests, not somebody's records, and nothing in the app reads it.
alter table public.signin_attempts enable row level security;

-- Supabase grants anon and authenticated table privileges by default. Take them
-- back, so a mistake in a future policy cannot expose which addresses asked for
-- a link and from where.
revoke all on table public.signin_attempts from anon, authenticated;

revoke all on function public.consume_signin_attempt(text, text) from public;
grant execute on function public.consume_signin_attempt(text, text) to anon, authenticated;

comment on table public.signin_attempts is
  'Sign-in link requests and whether one was sent. Written only by public.consume_signin_attempt; no policy grants anyone a read.';
comment on function public.consume_signin_attempt(text, text) is
  'Records a sign-in link request and returns whether it is within the limit: 5 per address per minute, 20 per IP per 15 minutes.';

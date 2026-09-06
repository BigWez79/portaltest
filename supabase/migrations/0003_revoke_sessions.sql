-- 0003_revoke_sessions.sql
-- Ending somebody's sessions when an admin deactivates them.
--
-- Deactivating already takes effect on the person's next page load: every route
-- reads the staff row fresh, so the tiles go and requireApp 404s. What was left
-- is that their session cookie stayed valid, so they saw a signed-in suite with
-- a no-access notice rather than the sign-in card. On the day somebody leaves
-- badly that is the wrong signal to send.
--
-- Why a function and not the service role: `auth.admin.signOut` in supabase-js
-- takes the *person's own JWT*, which the admin doing the deactivating does not
-- have, and there is no admin-API call that ends another user's sessions by id.
-- Deleting the session rows is the way, and CLAUDE.md allows the service role
-- exactly twice — inviting somebody, and the one-off CSV import. Neither is
-- this. So: a security definer function, called with the admin's own session,
-- which re-checks `public.is_admin()` itself rather than trusting the caller.
--
-- After the delete, the person's access token still parses, but Supabase Auth
-- rejects it: /auth/v1/user answers "Session from session_id claim in JWT does
-- not exist", getUser() returns no user, and getCurrentUser() returns null. The
-- suite cannot exercise that half — it reaches no Supabase project — so the
-- e2e test covers the fixture store's equivalent and this comment is the
-- record of what a deployed suite does.

create or replace function public.revoke_staff_sessions(p_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text    := lower(trim(p_email));
  v_user  uuid;
  v_count integer := 0;
begin
  -- The caller's own session decides this, the same way the update they just
  -- made was decided. A definer function with no check is a service-role read
  -- wearing a different hat.
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- lower(email::text) rather than `email = v_email`: staff.email is citext,
  -- but the cast the other way round is text -> citext by assignment only, so
  -- comparing a citext column to a text *variable* degrades to a
  -- case-sensitive text comparison. Spelling it out costs an index scan on one
  -- row and cannot be read wrongly.
  select user_id into v_user
    from public.staff
   where lower(email::text) = v_email;

  -- Nobody has accepted the invitation yet, so there is no session to end.
  if v_user is null then
    return 0;
  end if;

  delete from auth.sessions where user_id = v_user;
  get diagnostics v_count = row_count;

  -- auth.refresh_tokens.session_id cascades from the delete above in current
  -- GoTrue, but a token issued before sessions existed has none. user_id there
  -- is varchar, not uuid.
  delete from auth.refresh_tokens where user_id = v_user::text;

  return v_count;
end;
$$;

-- Owned by the role the migration runs as — postgres — which is what gives it
-- the delete on the auth schema. `authenticated` gets execute and nothing more;
-- anon has no business here at all.
revoke all on function public.revoke_staff_sessions(text) from public;
grant execute on function public.revoke_staff_sessions(text) to authenticated;

comment on function public.revoke_staff_sessions(text) is
  'Ends every session belonging to one staff member and returns how many there were. Called by the admin screen when active goes false. Refuses anybody who is not an active admin.';

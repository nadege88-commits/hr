-- 007 (same as operations/supabase/006_invites_change_email.sql, already applied): invites and fixing a mistyped email, for both apps (Operations and the Team app share this project and its logins).
-- Additive: two new functions, nothing existing changes. Safe on a project without the Team app: its tables and
-- functions are only touched when they exist. The same file is in the Team app repo (hr/supabase/007_...).

-- Who may manage people: an Operations owner, or a Team app admin.
create or replace function public.people_manager() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare hr text;
begin
  if public.my_role() is not distinct from 'owner' then return true; end if;
  if to_regprocedure('public.hr_role()') is not null then execute 'select public.hr_role()' into hr; end if;
  return coalesce(hr = 'admin', false);   -- a firm no, never unknown
end $$;
revoke all on function public.people_manager() from public, anon;
grant execute on function public.people_manager() to authenticated;

-- Who has set up their account (has a login), for the "Not set up yet" marker. Everyone on either app's list.
create or replace function public.team_setup() returns table(email text, set_up boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.people_manager() then return; end if;
  if to_regclass('public.hr_people') is not null then
    return query execute 'select e, exists (select 1 from auth.users u where lower(u.email) = e)
      from (select email e from public.members union select email from public.hr_people) x';
  else
    return query select m.email, exists (select 1 from auth.users u where lower(u.email) = m.email) from public.members m;
  end if;
end $$;
revoke all on function public.team_setup() from public, anon;
grant execute on function public.team_setup() to authenticated;

-- Change a person's email everywhere it is used: both people lists, their tasks, comments and inbox, their hours,
-- leave and inbox in the Team app, and their login if they already set one up (same password, new email).
-- Not on yourself, an Operations owner or a Team app admin.
create or replace function public.change_member_email(p_old text, p_new text) returns void
language plpgsql security definer set search_path = public as $$
declare o text := lower(trim(p_old)); n text := lower(trim(p_new)); uid uuid; c record; has_hr boolean := to_regclass('public.hr_people') is not null;
  in_ops boolean; in_hr boolean := false; taken boolean := false; hr_admin boolean := false;
begin
  if not public.people_manager() then raise exception 'Only an owner or admin can do this.' using errcode = '42501'; end if;
  if n !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address.'; end if;
  if o = n then return; end if;
  if o = public.my_email() then raise exception 'You cannot change your own email here.'; end if;
  in_ops := exists (select 1 from public.members where email = o);
  if has_hr then
    execute 'select exists (select 1 from public.hr_people where email = $1), exists (select 1 from public.hr_people where email = $2),
                    exists (select 1 from public.hr_people where email = $1 and role = ''admin'')' into in_hr, taken, hr_admin using o, n;
  end if;
  if not in_ops and not in_hr then raise exception 'That person is not on the team.'; end if;
  if exists (select 1 from public.members where email = o and role = 'owner') or hr_admin then
    raise exception 'An owner''s or admin''s email cannot be changed here.';
  end if;
  if taken or exists (select 1 from public.members where email = n) then raise exception 'That email is already on the team.'; end if;

  select id into uid from auth.users where lower(email) = o;
  if uid is not null then
    if exists (select 1 from auth.users where lower(email) = n) then
      raise exception 'Someone has already set up an account with that email.';
    end if;
    update auth.users set email = n, updated_at = now() where id = uid;
    update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(n)), updated_at = now()
      where user_id = uid and provider = 'email';
  end if;

  update public.members set email = n where email = o;
  update public.notes    set assignee   = n where assignee   = o;
  update public.notes    set created_by = n where created_by = o;
  update public.notes    set done_by    = n where done_by    = o;
  update public.jobs     set created_by = n where created_by = o;
  update public.jobs     set done_by    = n where done_by    = o;
  update public.comments set author     = n where author     = o;
  update public.inbox    set recipient  = n where recipient  = o;
  update public.inbox    set actor      = n where actor      = o;
  update public.push_subscriptions set email = n where email = o;

  -- The Team app. hr_people's email carries shifts and leave along (on update cascade).
  if has_hr then
    execute 'update public.hr_people set email = $2 where email = $1' using o, n;
    for c in select * from (values ('hr_inbox','recipient'), ('hr_leave','decided_by'), ('hr_shifts','edited_by'), ('hr_shifts','deleted_by'),
                                   ('hr_push_subscriptions','email'), ('hr_networks','created_by')) v(t, col) loop
      if to_regclass('public.' || c.t) is not null then
        execute format('update public.%I set %I = $2 where %I = $1', c.t, c.col, c.col) using o, n;
      end if;
    end loop;
  end if;
end $$;
revoke all on function public.change_member_email(text, text) from public, anon;
grant execute on function public.change_member_email(text, text) to authenticated;

-- 002: one people list for both apps, and phone notifications for time off.
-- Additive. Touches Operations in two small ways: a trigger that copies a changed name across, and
-- hr_save_person, which lets an Operations owner give or take Operations access from the HR people screen.

-- Everyone who is in HR and/or Operations, with their role in each. HR admins only.
create or replace function public.hr_directory()
returns table(email text, name text, job text, hr_role text, ops_role text, venue_ids text[])
language sql stable security definer set search_path = public as $$
  select coalesce(h.email, m.email), coalesce(nullif(h.name,''), m.name, ''), coalesce(h.job,''),
         case when h.active then h.role end, m.role, coalesce(h.venue_ids, m.venue_ids, '{}')
  from public.hr_people h full join public.members m on m.email = h.email
  where public.hr_role() = 'admin'
$$;

-- Add or change a person once, for both apps. p_hr_role / p_ops_role null means no access to that app.
create or replace function public.hr_save_person(p_email text, p_name text, p_job text, p_hr_role text, p_ops_role text, p_venues text[]) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); em text := lower(trim(p_email)); cur_ops text; nm text := trim(coalesce(p_name,''));
begin
  if public.hr_role() is distinct from 'admin' then raise exception 'Only an admin can change people.' using errcode = '42501'; end if;
  if em !~ '^\S+@\S+\.\S+$' then raise exception 'Add their email address.'; end if;
  if nm = '' then raise exception 'Add a name.'; end if;
  if p_hr_role is not null and p_hr_role not in ('employee','manager','admin') then raise exception 'Unknown role.'; end if;
  if p_ops_role is not null and p_ops_role not in ('owner','admin','manager','maintenance') then raise exception 'Unknown Operations role.'; end if;
  if em = me and p_hr_role is distinct from 'admin' then raise exception 'You cannot remove your own admin access.'; end if;

  if p_hr_role is null then
    update public.hr_people set active = false, name = nm, job = coalesce(p_job,''), venue_ids = coalesce(p_venues,'{}') where email = em;
  else
    insert into public.hr_people(email, name, job, role, venue_ids, active) values (em, nm, coalesce(p_job,''), p_hr_role, coalesce(p_venues,'{}'), true)
    on conflict (email) do update set name = excluded.name, job = excluded.job, role = excluded.role, venue_ids = excluded.venue_ids, active = true;
  end if;

  select role into cur_ops from public.members where email = em;
  if p_ops_role is distinct from cur_ops then
    if public.my_role() is distinct from 'owner' then raise exception 'Only an Operations owner can change Operations access.' using errcode = '42501'; end if;
    if em = me then raise exception 'You cannot change your own Operations access.'; end if;
    if p_ops_role is null then delete from public.members where email = em;
    elsif cur_ops is null then
      insert into public.members(email, role, name, venue_ids) values (em, p_ops_role, nm, case when p_ops_role = 'manager' then coalesce(p_venues,'{}') else '{}' end);
    else update public.members set role = p_ops_role where email = em;
    end if;
  end if;
  update public.members set name = nm where email = em and name is distinct from nm;     -- venues in Operations are left alone: they also hold areas HR does not know
end $$;
revoke all on function public.hr_save_person(text,text,text,text,text,text[]) from public, anon;
grant execute on function public.hr_save_person(text,text,text,text,text,text[]) to authenticated;
revoke all on function public.hr_directory() from public, anon;
grant execute on function public.hr_directory() to authenticated;

-- People are now only changed through hr_save_person (it has the safety checks).
drop policy if exists hr_people_admin on public.hr_people;

-- A name changed in Operations' Settings follows into HR.
create or replace function public.hr_sync_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.name,'') <> '' then
    update public.hr_people set name = new.name where email = new.email and name is distinct from new.name;
  end if;
  return new;
end $$;
drop trigger if exists hr_sync_name on public.members;
create trigger hr_sync_name after insert or update of name on public.members for each row execute function public.hr_sync_name();

-- Phones that allowed notifications for the HR app (kept apart from Operations' list: each app has its own).
create table if not exists public.hr_push_subscriptions (
  endpoint text primary key,
  email text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.hr_push_subscriptions enable row level security;
drop policy if exists hr_push_own_read on public.hr_push_subscriptions;
create policy hr_push_own_read on public.hr_push_subscriptions for select to authenticated using (email = public.hr_email());

create or replace function public.hr_save_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) returns void
language sql security definer set search_path = public as $$
  insert into public.hr_push_subscriptions(endpoint, email, p256dh, auth, user_agent)
  select p_endpoint, public.hr_email(), p_p256dh, p_auth, left(p_user_agent, 300) where public.hr_role() is not null
  on conflict (endpoint) do update set email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = now()
$$;
create or replace function public.hr_remove_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.hr_push_subscriptions where endpoint = p_endpoint and email = public.hr_email()
$$;
revoke all on function public.hr_save_push(text,text,text,text) from public, anon;
revoke all on function public.hr_remove_push(text) from public, anon;
grant execute on function public.hr_save_push(text,text,text,text) to authenticated;
grant execute on function public.hr_remove_push(text) to authenticated;

-- The sender (functions/hr-push) is called by a timer every minute; the schedule is added once it is deployed.

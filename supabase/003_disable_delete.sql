-- 003: switch a person off, or delete them for good. HR admins only; anything touching Operations needs an Operations owner.
-- Additive: two functions.

-- Disable: no access to either app. Hours, time off and history are kept, and the person can be switched back on.
create or replace function public.hr_disable_person(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); em text := lower(trim(p_email)); cur_ops text;
begin
  if public.hr_role() is distinct from 'admin' then raise exception 'Only an admin can change people.' using errcode = '42501'; end if;
  if em = me then raise exception 'You cannot disable yourself.'; end if;
  select role into cur_ops from public.members where email = em;
  if cur_ops = 'owner' then raise exception 'This person is an Operations owner. Change their Operations role first.'; end if;
  update public.hr_people set active = false where email = em;
  delete from public.hr_push_subscriptions where email = em;
  if cur_ops is not null and public.my_role() = 'owner' then
    delete from public.members where email = em;
    delete from public.push_subscriptions where email = em;
  end if;
end $$;

-- Delete: the person, their login, their hours and their time off requests are removed for good.
create or replace function public.hr_delete_person(p_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare me text := public.hr_email(); em text := lower(trim(p_email)); cur_ops text;
begin
  if public.hr_role() is distinct from 'admin' then raise exception 'Only an admin can change people.' using errcode = '42501'; end if;
  if em = me then raise exception 'You cannot delete yourself.'; end if;
  select role into cur_ops from public.members where email = em;
  if cur_ops = 'owner' then raise exception 'This person is an Operations owner. Change their Operations role first.'; end if;
  if cur_ops is not null and public.my_role() is distinct from 'owner' then
    raise exception 'This person also uses Operations. Only an Operations owner can delete them.' using errcode = '42501';
  end if;
  delete from public.hr_inbox where recipient = em;
  delete from public.hr_push_subscriptions where email = em;
  delete from public.hr_leave where person = em;
  delete from public.hr_shifts where person = em;
  delete from public.hr_people where email = em;
  delete from public.push_subscriptions where email = em;
  delete from public.members where email = em;
  delete from auth.users where lower(email) = em;          -- the login itself
end $$;

revoke all on function public.hr_disable_person(text) from public, anon;
revoke all on function public.hr_delete_person(text) from public, anon;
grant execute on function public.hr_disable_person(text) to authenticated;
grant execute on function public.hr_delete_person(text) to authenticated;

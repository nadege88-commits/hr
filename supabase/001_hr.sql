-- Northpoint Team (HR): people, shifts, time off and an inbox, in the same project as Operations.
-- Additive: only creates hr_* tables and functions, plus one extra read rule on venues so HR people can see venue names.
-- Safe to run again.

-- Who may use the HR app, and as what. Same logins as Operations (same email + password).
create table if not exists public.hr_people (
  email text primary key check (email = lower(email)),
  name text not null default '',
  job text not null default '',
  role text not null default 'employee' check (role in ('employee','manager','admin')),
  venue_ids text[] not null default '{}',
  active boolean not null default true,          -- people are switched off, never deleted, so their hours stay
  created_at timestamptz not null default now()
);

create table if not exists public.hr_shifts (
  id uuid primary key default gen_random_uuid(),
  person text not null references public.hr_people(email) on update cascade,
  venue_id text not null,
  clock_in timestamptz not null,
  clock_out timestamptz,
  added boolean not null default false,          -- added by a manager rather than clocked
  edited_by text, edited_at timestamptz, edit_reason text,
  orig_in timestamptz, orig_out timestamptz,     -- what was first recorded, kept when a manager corrects it
  deleted_at timestamptz, deleted_by text,
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out > clock_in)
);
create unique index if not exists hr_one_open_shift on public.hr_shifts(person) where clock_out is null and deleted_at is null;
create index if not exists hr_shifts_clock_in on public.hr_shifts(clock_in);

create table if not exists public.hr_leave (
  id uuid primary key default gen_random_uuid(),
  person text not null references public.hr_people(email) on update cascade,
  type text not null check (type in ('holiday','sick','unpaid','other')),
  from_date date not null,
  to_date date not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by text, decided_at timestamptz,
  reason text not null default '',
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);

create table if not exists public.hr_inbox (
  id bigint generated always as identity primary key,
  recipient text not null,
  kind text not null,
  body text not null,
  tab text not null default 'inbox',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz
);
create index if not exists hr_inbox_recipient on public.hr_inbox(recipient, id desc);

-- Who am I in HR?
create or replace function public.hr_email() returns text language sql stable as $$
  select lower(auth.jwt() ->> 'email')
$$;
create or replace function public.hr_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.hr_people where email = lower(auth.jwt() ->> 'email') and active
$$;
create or replace function public.hr_venues() returns text[]
language sql stable security definer set search_path = public as $$
  select venue_ids from public.hr_people where email = lower(auth.jwt() ->> 'email') and active
$$;
-- May I correct this person's hours and decide their time off? Admins: everyone. Managers: employees who share a venue with them.
create or replace function public.hr_manages(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.hr_role()
    when 'admin' then true
    when 'manager' then exists (select 1 from public.hr_people p where p.email = p_email and p.role = 'employee' and p.venue_ids && public.hr_venues())
    else false end
$$;

alter table public.hr_people enable row level security;
alter table public.hr_shifts enable row level security;
alter table public.hr_leave  enable row level security;
alter table public.hr_inbox  enable row level security;

-- Reading. Shifts and time off are only changed through the functions below, so there are no write rules for them.
drop policy if exists hr_people_read on public.hr_people;
create policy hr_people_read on public.hr_people for select to authenticated
  using (public.hr_role() is not null or email = public.hr_email());
drop policy if exists hr_people_admin on public.hr_people;
create policy hr_people_admin on public.hr_people for all to authenticated
  using (public.hr_role() = 'admin') with check (public.hr_role() = 'admin');

drop policy if exists hr_shifts_read on public.hr_shifts;
create policy hr_shifts_read on public.hr_shifts for select to authenticated using (
  (person = public.hr_email() and public.hr_role() is not null)
  or public.hr_role() = 'admin'
  or (public.hr_role() = 'manager' and venue_id = any(public.hr_venues()) and public.hr_manages(person)));

drop policy if exists hr_leave_read on public.hr_leave;
create policy hr_leave_read on public.hr_leave for select to authenticated using (
  (person = public.hr_email() and public.hr_role() is not null) or public.hr_manages(person));

drop policy if exists hr_inbox_read on public.hr_inbox;
create policy hr_inbox_read on public.hr_inbox for select to authenticated using (recipient = public.hr_email());
drop policy if exists hr_inbox_mark on public.hr_inbox;
create policy hr_inbox_mark on public.hr_inbox for update to authenticated
  using (recipient = public.hr_email()) with check (recipient = public.hr_email());

-- HR people may read venue names (Operations keeps its own rule; this one is added next to it).
drop policy if exists hr_venues_read on public.venues;
create policy hr_venues_read on public.venues for select to authenticated using (public.hr_role() is not null);

-- Helpers used inside the functions (not callable from the app).
create or replace function public.hr_my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(name,''), email) from public.hr_people where email = lower(auth.jwt() ->> 'email')
$$;
create or replace function public.hr_day(t timestamptz) returns text language sql stable as $$
  select to_char(t at time zone 'Europe/Malta', 'Dy FMDD Mon')
$$;
create or replace function public.hr_range(a date, b date) returns text language sql immutable as $$
  select case when a = b then to_char(a, 'Dy FMDD Mon') else to_char(a, 'Dy FMDD Mon') || ' – ' || to_char(b, 'Dy FMDD Mon') end
$$;
create or replace function public.hr_leave_label(t text) returns text language sql immutable as $$
  select case t when 'holiday' then 'Holiday' when 'sick' then 'Sick leave' when 'unpaid' then 'Unpaid leave' else 'Other' end
$$;
create or replace function public.hr_notify(p_to text, p_kind text, p_body text, p_tab text) returns void
language sql security definer set search_path = public as $$
  insert into public.hr_inbox(recipient, kind, body, tab)
  select p_to, p_kind, p_body, p_tab where p_to is distinct from lower(auth.jwt() ->> 'email')
$$;

-- Clock in and out. The server's clock is used, so the phone's time cannot be changed to cheat.
create or replace function public.hr_clock_in(p_venue text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); r text := public.hr_role(); new_id uuid;
begin
  if r is null then raise exception 'This account is not on the team.' using errcode = '42501'; end if;
  if r <> 'admin' and not (p_venue = any(public.hr_venues())) then raise exception 'You are not set up for this venue.' using errcode = '42501'; end if;
  if exists (select 1 from public.hr_shifts where person = me and clock_out is null and deleted_at is null) then
    raise exception 'You are already clocked in.';
  end if;
  insert into public.hr_shifts(person, venue_id, clock_in) values (me, p_venue, now()) returning id into new_id;
  return new_id;
end $$;

create or replace function public.hr_clock_out() returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email();
begin
  update public.hr_shifts set clock_out = now() where person = me and clock_out is null and deleted_at is null;
  if not found then raise exception 'You are not clocked in.'; end if;
end $$;

-- A manager or admin corrects a shift (p_id given) or adds a missing one (p_id null). Always with a reason; the person is told.
create or replace function public.hr_save_shift(p_id uuid, p_person text, p_venue text, p_in timestamptz, p_out timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); r text := public.hr_role(); s public.hr_shifts;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'Add a short reason.'; end if;
  if p_in > now() or (p_out is not null and p_out > now() + interval '1 minute') then raise exception 'A shift cannot be in the future.'; end if;
  if p_out is not null and (p_out <= p_in or p_out - p_in > interval '20 hours') then raise exception 'Check the times.'; end if;
  if p_id is null then
    if not public.hr_manages(p_person) or (r = 'manager' and not (p_venue = any(public.hr_venues()))) then
      raise exception 'You cannot change this person''s hours.' using errcode = '42501';
    end if;
    insert into public.hr_shifts(person, venue_id, clock_in, clock_out, added, edited_by, edited_at, edit_reason)
      values (p_person, p_venue, p_in, p_out, true, me, now(), trim(p_reason));
    perform public.hr_notify(p_person, 'shift', public.hr_my_name() || ' added a shift for you on ' || public.hr_day(p_in) || ': ' || trim(p_reason), 'hours');
  else
    select * into s from public.hr_shifts where id = p_id and deleted_at is null;
    if not found then raise exception 'That shift no longer exists.'; end if;
    if not public.hr_manages(s.person) or (r = 'manager' and not (s.venue_id = any(public.hr_venues()) and p_venue = any(public.hr_venues()))) then
      raise exception 'You cannot change this person''s hours.' using errcode = '42501';
    end if;
    update public.hr_shifts set
      orig_in  = case when edited_at is null then clock_in  else orig_in  end,
      orig_out = case when edited_at is null then clock_out else orig_out end,
      venue_id = p_venue, clock_in = p_in, clock_out = p_out, edited_by = me, edited_at = now(), edit_reason = trim(p_reason)
    where id = p_id;
    perform public.hr_notify(s.person, 'shift', public.hr_my_name() || ' changed your shift on ' || public.hr_day(p_in) || ': ' || trim(p_reason), 'hours');
  end if;
end $$;

create or replace function public.hr_delete_shift(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); r text := public.hr_role(); s public.hr_shifts;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'Add a short reason.'; end if;
  select * into s from public.hr_shifts where id = p_id and deleted_at is null;
  if not found then raise exception 'That shift no longer exists.'; end if;
  if not public.hr_manages(s.person) or (r = 'manager' and not (s.venue_id = any(public.hr_venues()))) then
    raise exception 'You cannot change this person''s hours.' using errcode = '42501';
  end if;
  update public.hr_shifts set deleted_at = now(), deleted_by = me, edit_reason = trim(p_reason) where id = p_id;
  perform public.hr_notify(s.person, 'shift', public.hr_my_name() || ' removed your shift on ' || public.hr_day(s.clock_in) || ': ' || trim(p_reason), 'hours');
end $$;

-- Time off. An employee's request goes to the managers of their venues; with no such manager, or for a manager's own request, it goes to the admins.
create or replace function public.hr_request_leave(p_type text, p_from date, p_to date, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); r text := public.hr_role(); new_id uuid;
begin
  if r is null then raise exception 'This account is not on the team.' using errcode = '42501'; end if;
  insert into public.hr_leave(person, type, from_date, to_date, note) values (me, p_type, p_from, p_to, coalesce(trim(p_note),'')) returning id into new_id;
  insert into public.hr_inbox(recipient, kind, body, tab)
  with mgrs as (
    select email from public.hr_people m where r = 'employee' and m.active and m.role = 'manager' and m.venue_ids && public.hr_venues()
  ), pick as (
    select email from mgrs
    union select email from public.hr_people where active and role = 'admin' and not exists (select 1 from mgrs)
  )
  select email, 'leave', public.hr_my_name() || ' asked for ' || public.hr_leave_label(p_type) || ', ' || public.hr_range(p_from, p_to), 'leave'
  from pick where email <> me;
  return new_id;
end $$;

create or replace function public.hr_cancel_leave(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.hr_leave set status = 'cancelled' where id = p_id and person = public.hr_email() and status = 'pending';
  if not found then raise exception 'Only a request that is still waiting can be cancelled.'; end if;
end $$;

create or replace function public.hr_decide_leave(p_id uuid, p_ok boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); l public.hr_leave;
begin
  select * into l from public.hr_leave where id = p_id;
  if not found or l.status <> 'pending' then raise exception 'This request is no longer waiting.'; end if;
  if not public.hr_manages(l.person) then raise exception 'You cannot decide this request.' using errcode = '42501'; end if;
  if not p_ok and coalesce(trim(p_reason),'') = '' then raise exception 'Write a reason so they know why.'; end if;
  update public.hr_leave set status = case when p_ok then 'approved' else 'rejected' end, decided_by = me, decided_at = now(), reason = coalesce(trim(p_reason),'') where id = p_id;
  perform public.hr_notify(l.person, 'decision',
    public.hr_my_name() || case when p_ok then ' approved' else ' rejected' end || ' your ' || public.hr_leave_label(l.type) || ', ' || public.hr_range(l.from_date, l.to_date)
      || case when coalesce(trim(p_reason),'') <> '' then ': ' || trim(p_reason) else '' end, 'leave');
end $$;

-- Only signed-in people may call the app functions; the inbox helper is internal.
revoke all on function public.hr_notify(text,text,text,text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['hr_clock_in(text)','hr_clock_out()','hr_save_shift(uuid,text,text,timestamptz,timestamptz,text)','hr_delete_shift(uuid,text)',
                           'hr_request_leave(text,date,date,text)','hr_cancel_leave(uuid)','hr_decide_leave(uuid,boolean,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- First people: the owners of Operations start as HR admins.
insert into public.hr_people(email, name, role)
  select lower(email), coalesce(name,''), 'admin' from public.members where role = 'owner'
  on conflict (email) do nothing;

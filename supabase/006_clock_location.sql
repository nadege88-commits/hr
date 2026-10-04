-- 006: the phone's location at clock-in and clock-out, taken once at the tap (no tracking), so an admin can
-- open a pin on a map when in doubt. Same rules as the networks in 004: nothing is blocked, nobody is alerted,
-- only HR admins can read it. Additive: the old hr_clock_in(text) / hr_clock_out() stay for phones on the old app.

alter table public.hr_shift_net add column if not exists in_lat double precision;
alter table public.hr_shift_net add column if not exists in_lng double precision;
alter table public.hr_shift_net add column if not exists in_acc real;          -- metres, as the phone reports it
alter table public.hr_shift_net add column if not exists out_lat double precision;
alter table public.hr_shift_net add column if not exists out_lng double precision;
alter table public.hr_shift_net add column if not exists out_acc real;

-- A location only counts when it is a real coordinate; anything else is stored as no location.
create or replace function public.hr_ok_loc(p_lat double precision, p_lng double precision) returns boolean
language sql immutable as $$
  select p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180
$$;

create or replace function public.hr_clock_in(p_venue text, p_lat double precision, p_lng double precision, p_acc double precision) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  new_id := public.hr_clock_in(p_venue);                   -- all the usual checks, server time and network
  if public.hr_ok_loc(p_lat, p_lng) then
    update public.hr_shift_net set in_lat = p_lat, in_lng = p_lng, in_acc = greatest(p_acc, 0) where shift_id = new_id;
  end if;
  return new_id;
end $$;

create or replace function public.hr_clock_out(p_lat double precision, p_lng double precision, p_acc double precision) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); sid uuid;
begin
  perform public.hr_clock_out();                           -- all the usual checks, server time and network
  if public.hr_ok_loc(p_lat, p_lng) then
    select id into sid from public.hr_shifts where person = me and clock_out is not null and deleted_at is null order by clock_out desc limit 1;
    update public.hr_shift_net set out_lat = p_lat, out_lng = p_lng, out_acc = greatest(p_acc, 0) where shift_id = sid;
  end if;
end $$;

revoke all on function public.hr_clock_in(text, double precision, double precision, double precision) from public, anon;
revoke all on function public.hr_clock_out(double precision, double precision, double precision) from public, anon;
grant execute on function public.hr_clock_in(text, double precision, double precision, double precision) to authenticated;
grant execute on function public.hr_clock_out(double precision, double precision, double precision) to authenticated;

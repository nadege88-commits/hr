-- 004: note which network each clock-in and clock-out came from. Nothing is blocked and nobody is alerted;
-- only HR admins can read it, to look into a doubt. Additive.

-- Kept apart from hr_shifts so employees and managers never receive it.
create table if not exists public.hr_shift_net (
  shift_id uuid primary key references public.hr_shifts(id) on delete cascade,
  in_ip inet, in_net text,
  out_ip inet, out_net text,
  at timestamptz not null default now()
);
-- Networks an admin has named, for example a venue's Wi-Fi.
create table if not exists public.hr_networks (
  net text primary key,
  label text not null,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.hr_shift_net enable row level security;
alter table public.hr_networks  enable row level security;
drop policy if exists hr_shift_net_admin on public.hr_shift_net;
create policy hr_shift_net_admin on public.hr_shift_net for select to authenticated using (public.hr_role() = 'admin');
drop policy if exists hr_networks_admin on public.hr_networks;
create policy hr_networks_admin on public.hr_networks for select to authenticated using (public.hr_role() = 'admin');

-- The address the request came from, as passed on by the API gateway.
create or replace function public.hr_client_ip() returns inet language plpgsql stable as $$
declare hd json; raw text;
begin
  hd := nullif(current_setting('request.headers', true), '')::json;
  raw := coalesce(hd->>'cf-connecting-ip', split_part(hd->>'x-forwarded-for', ',', 1), hd->>'x-real-ip');
  return nullif(trim(raw), '')::inet;
exception when others then return null;
end $$;
-- One key per network: the address itself for IPv4; for IPv6 the first half, which is shared by every device on the same Wi-Fi.
create or replace function public.hr_net_key(ip inet) returns text language sql immutable as $$
  select case when ip is null then null when family(ip) = 6 then host(network(set_masklen(ip, 64))) || '/64' else host(ip) end
$$;

create or replace function public.hr_clock_in(p_venue text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); r text := public.hr_role(); new_id uuid; ip inet := public.hr_client_ip();
begin
  if r is null then raise exception 'This account is not on the team.' using errcode = '42501'; end if;
  if r <> 'admin' and not (p_venue = any(public.hr_venues())) then raise exception 'You are not set up for this venue.' using errcode = '42501'; end if;
  if exists (select 1 from public.hr_shifts where person = me and clock_out is null and deleted_at is null) then
    raise exception 'You are already clocked in.';
  end if;
  insert into public.hr_shifts(person, venue_id, clock_in) values (me, p_venue, now()) returning id into new_id;
  insert into public.hr_shift_net(shift_id, in_ip, in_net) values (new_id, ip, public.hr_net_key(ip));
  return new_id;
end $$;

create or replace function public.hr_clock_out() returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.hr_email(); sid uuid; ip inet := public.hr_client_ip();
begin
  update public.hr_shifts set clock_out = now() where person = me and clock_out is null and deleted_at is null returning id into sid;
  if sid is null then raise exception 'You are not clocked in.'; end if;
  insert into public.hr_shift_net(shift_id, out_ip, out_net) values (sid, ip, public.hr_net_key(ip))
  on conflict (shift_id) do update set out_ip = excluded.out_ip, out_net = excluded.out_net;
end $$;

-- Name a network (or clear its name with an empty label). Admins only.
create or replace function public.hr_label_network(p_net text, p_label text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.hr_role() is distinct from 'admin' then raise exception 'Only an admin can do this.' using errcode = '42501'; end if;
  if coalesce(trim(p_label),'') = '' then delete from public.hr_networks where net = p_net;
  else insert into public.hr_networks(net, label, created_by) values (p_net, trim(p_label), public.hr_email())
       on conflict (net) do update set label = excluded.label;
  end if;
end $$;
revoke all on function public.hr_label_network(text,text) from public, anon;
grant execute on function public.hr_label_network(text,text) to authenticated;

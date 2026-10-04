-- 005: one consistent copy of every table, for the nightly backup. Only the server-side key may call it.
create or replace function public.backup_dump() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; rows jsonb; result jsonb := '{}'::jsonb;
begin
  for t in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into rows;
    result := result || jsonb_build_object(t, rows);
  end loop;
  -- who has a login (no passwords)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at)), '[]'::jsonb) into rows from auth.users;
  return result || jsonb_build_object('_logins', rows, '_taken_at', to_jsonb(now()));
end $$;
revoke all on function public.backup_dump() from public, anon, authenticated;
grant execute on function public.backup_dump() to service_role;

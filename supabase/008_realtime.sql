-- 008: live updates. The app is told the moment a clock-in, clock-out, time off request or inbox message changes,
-- instead of waiting for its next check. Each phone still only hears about rows its read rules let it see.
-- Additive: only adds the Team app tables to Supabase's live-updates list (Operations' tables are already on it).
do $$
declare t text;
begin
  foreach t in array array['hr_shifts','hr_leave','hr_inbox','hr_people'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

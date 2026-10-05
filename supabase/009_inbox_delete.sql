-- 009: people can delete their own Team app inbox messages (swipe left in the Inbox). Only their own; nothing else changes.
drop policy if exists hr_inbox_delete_mine on public.hr_inbox;
create policy hr_inbox_delete_mine on public.hr_inbox for delete to authenticated using (recipient = public.hr_email());

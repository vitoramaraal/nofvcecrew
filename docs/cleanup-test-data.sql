-- Optional cleanup for test data in Supabase.
-- Run this only when you want to remove generated test crew content.

delete from public.event_rsvps;
delete from public.crew_events;
delete from public.feed_comments;
delete from public.feed_likes;
delete from public.feed_posts;
delete from public.chat_messages;
delete from public.admin_audit_logs;
delete from public.members;
delete from public.applications;

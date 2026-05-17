-- NoFvce Crew MVP schema
-- Run this in the Supabase SQL editor for the project used by frontend/.env.

create extension if not exists pgcrypto;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  instagram text not null,
  whatsapp text not null,
  car_model text not null,
  car_setup text,
  message text,
  image_name text,
  image_url text,
  image_path text,
  member_photo_url text,
  member_photo_path text,
  identity_rule_confirmed boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.applications
  add column if not exists identity_rule_confirmed boolean not null default false;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete set null,
  full_name text not null,
  instagram text,
  whatsapp text,
  car_model text,
  car_setup text,
  bio text,
  car_specs text,
  car_mods text,
  gallery_urls jsonb not null default '[]'::jsonb,
  image_url text,
  member_photo_url text,
  member_photo_path text,
  role text not null default 'member'
    check (role in ('founder', 'admin', 'moderator', 'member')),
  access_code text unique not null,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  member_number text unique not null,
  profile_updated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.members
  add column if not exists role text;

alter table public.members
  add column if not exists access_code text;

alter table public.members
  add column if not exists bio text;

alter table public.members
  add column if not exists car_specs text;

alter table public.members
  add column if not exists car_mods text;

alter table public.members
  add column if not exists gallery_urls jsonb not null default '[]'::jsonb;

alter table public.members
  add column if not exists profile_updated_at timestamptz;

alter table public.members
  alter column role set default 'member';

update public.members
set role = 'member'
where role is null;

update public.members
set access_code = concat('LEGACY-', upper(substr(id::text, 1, 8)))
where access_code is null;

alter table public.members
  alter column role set not null;

alter table public.members
  alter column access_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'members_role_check'
  ) then
    alter table public.members
      add constraint members_role_check
      check (role in ('founder', 'admin', 'moderator', 'member'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'members_access_code_key'
  ) then
    alter table public.members
      add constraint members_access_code_key unique (access_code);
  end if;
end $$;

create index if not exists applications_status_created_at_idx
  on public.applications (status, created_at desc);

create index if not exists members_status_created_at_idx
  on public.members (status, created_at desc);

create index if not exists members_access_code_idx
  on public.members (access_code);

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'admin'
    check (role in ('founder', 'admin', 'moderator')),
  created_at timestamptz not null default now()
);

alter table public.admin_users
  drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (role in ('founder', 'admin', 'moderator'));

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_email text,
  admin_role text not null,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);

create index if not exists admin_audit_logs_admin_user_id_idx
  on public.admin_audit_logs (admin_user_id);

create index if not exists admin_audit_logs_action_idx
  on public.admin_audit_logs (action);

create or replace function public.current_admin_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select admin_users.role
  from public.admin_users
  where admin_users.id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_admin_role() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    public.current_admin_role() in ('founder', 'admin', 'moderator'),
    false
  );
$$;

grant execute on function public.is_admin() to authenticated;

create or replace function public.can_review_applications()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    public.current_admin_role() in ('founder', 'admin', 'moderator'),
    false
  );
$$;

grant execute on function public.can_review_applications() to authenticated;

create or replace function public.can_manage_members()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_admin_role() in ('founder', 'admin'), false);
$$;

grant execute on function public.can_manage_members() to authenticated;

create or replace function public.write_admin_audit_log(
  admin_action text,
  target_kind text,
  target_uuid uuid default null,
  audit_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_log_id uuid;
begin
  if not public.can_review_applications() then
    raise exception 'Admin access required.';
  end if;

  insert into public.admin_audit_logs (
    admin_user_id,
    admin_email,
    admin_role,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    auth.uid(),
    coalesce(
      auth.jwt() ->> 'email',
      (
        select admin_users.email
        from public.admin_users
        where admin_users.id = auth.uid()
        limit 1
      )
    ),
    coalesce(public.current_admin_role(), 'unknown'),
    admin_action,
    target_kind,
    target_uuid,
    coalesce(audit_metadata, '{}'::jsonb)
  )
  returning id into created_log_id;

  return created_log_id;
end;
$$;

revoke all on function public.write_admin_audit_log(text, text, uuid, jsonb)
  from public, anon, authenticated;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

create index if not exists chat_messages_member_id_idx
  on public.chat_messages (member_id);

create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 700),
  image_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feed_posts_created_at_idx
  on public.feed_posts (created_at desc);

create index if not exists feed_posts_member_id_idx
  on public.feed_posts (member_id);

create table if not exists public.feed_likes (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, member_id)
);

create index if not exists feed_likes_member_id_idx
  on public.feed_likes (member_id);

create table if not exists public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 400),
  created_at timestamptz not null default now()
);

create index if not exists feed_comments_post_id_created_at_idx
  on public.feed_comments (post_id, created_at asc);

create index if not exists feed_comments_member_id_idx
  on public.feed_comments (member_id);

create table if not exists public.crew_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  starts_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed', 'completed', 'cancelled')),
  capacity integer check (capacity is null or capacity > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crew_events_starts_at_idx
  on public.crew_events (starts_at desc);

create index if not exists crew_events_status_idx
  on public.crew_events (status);

create table if not exists public.event_rsvps (
  event_id uuid not null references public.crew_events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  status text not null default 'going'
    check (status in ('going', 'not_going')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);

create index if not exists event_rsvps_member_id_idx
  on public.event_rsvps (member_id);

create index if not exists event_rsvps_event_status_idx
  on public.event_rsvps (event_id, status);

insert into storage.buckets (id, name, public)
values ('application-photos', 'application-photos', true)
on conflict (id) do update set public = excluded.public;

alter table public.applications enable row level security;
alter table public.members enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.chat_messages enable row level security;
alter table public.feed_posts enable row level security;
alter table public.feed_likes enable row level security;
alter table public.feed_comments enable row level security;
alter table public.crew_events enable row level security;
alter table public.event_rsvps enable row level security;

drop policy if exists "Admins can read admin users" on public.admin_users;
create policy "Admins can read admin users"
  on public.admin_users
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Managers can read admin audit logs" on public.admin_audit_logs;
create policy "Managers can read admin audit logs"
  on public.admin_audit_logs
  for select
  to authenticated
  using (public.can_manage_members());

drop policy if exists "Public can create applications" on public.applications;
create policy "Public can create applications"
  on public.applications
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and identity_rule_confirmed = true
  );

drop policy if exists "Public can upload application photos" on storage.objects;
create policy "Public can upload application photos"
  on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'application-photos');

drop policy if exists "Public can read application photos" on storage.objects;
create policy "Public can read application photos"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'application-photos');

drop policy if exists "Prototype admin can read applications" on public.applications;
drop policy if exists "Prototype admin can update applications" on public.applications;
drop policy if exists "Prototype admin can delete applications" on public.applications;
drop policy if exists "Admins can read applications" on public.applications;
create policy "Admins can read applications"
  on public.applications
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Admins can update applications" on public.applications;
drop policy if exists "Admins can delete applications" on public.applications;

drop policy if exists "Prototype admin can create members" on public.members;
drop policy if exists "Prototype admin can read members" on public.members;
drop policy if exists "Prototype admin can update members" on public.members;
drop policy if exists "Prototype admin can delete members" on public.members;
drop policy if exists "Admins can create members" on public.members;

drop policy if exists "Admins can read members" on public.members;
create policy "Admins can read members"
  on public.members
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Admins can update members" on public.members;
drop policy if exists "Admins can delete members" on public.members;

drop policy if exists "Members can read chat messages" on public.chat_messages;
drop policy if exists "Members can create chat messages" on public.chat_messages;
drop policy if exists "Admins can read chat messages" on public.chat_messages;
create policy "Admins can read chat messages"
  on public.chat_messages
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Admins can delete chat messages" on public.chat_messages;

drop policy if exists "Admins can read feed posts" on public.feed_posts;
create policy "Admins can read feed posts"
  on public.feed_posts
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Admins can delete feed posts" on public.feed_posts;

drop policy if exists "Admins can read feed likes" on public.feed_likes;
create policy "Admins can read feed likes"
  on public.feed_likes
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Admins can read feed comments" on public.feed_comments;
create policy "Admins can read feed comments"
  on public.feed_comments
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Admins can delete feed comments" on public.feed_comments;

drop policy if exists "Admins can read crew events" on public.crew_events;
create policy "Admins can read crew events"
  on public.crew_events
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Admins can create crew events" on public.crew_events;
drop policy if exists "Admins can update crew events" on public.crew_events;
drop policy if exists "Admins can delete crew events" on public.crew_events;

drop policy if exists "Admins can read event rsvps" on public.event_rsvps;
create policy "Admins can read event rsvps"
  on public.event_rsvps
  for select
  to authenticated
  using (public.can_review_applications());

drop policy if exists "Admins can create event rsvps" on public.event_rsvps;
drop policy if exists "Admins can update event rsvps" on public.event_rsvps;
drop policy if exists "Admins can delete event rsvps" on public.event_rsvps;

revoke update, delete on public.applications from authenticated;
revoke insert, update, delete on public.members from authenticated;
revoke insert, update, delete on public.chat_messages from authenticated;
revoke insert, update, delete on public.feed_posts from authenticated;
revoke insert, update, delete on public.feed_likes from authenticated;
revoke insert, update, delete on public.feed_comments from authenticated;
revoke insert, update, delete on public.crew_events from authenticated;
revoke insert, update, delete on public.event_rsvps from authenticated;

grant insert on public.applications to anon, authenticated;
grant select on public.applications to authenticated;
grant select on public.members to authenticated;
grant select on public.admin_users to authenticated;
grant select on public.admin_audit_logs to authenticated;
grant select on public.chat_messages to authenticated;
grant select on public.feed_posts to authenticated;
grant select on public.feed_likes to authenticated;
grant select on public.feed_comments to authenticated;
grant select on public.crew_events to authenticated;
grant select on public.event_rsvps to authenticated;

create or replace function public.create_application(
  candidate_full_name text,
  candidate_instagram text,
  candidate_whatsapp text,
  candidate_car_model text,
  candidate_message text,
  candidate_image_name text,
  candidate_image_url text,
  candidate_image_path text,
  candidate_member_photo_url text,
  candidate_member_photo_path text,
  candidate_identity_rule_confirmed boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_full_name text := trim(coalesce(candidate_full_name, ''));
  normalized_instagram text := trim(coalesce(candidate_instagram, ''));
  normalized_whatsapp text := trim(coalesce(candidate_whatsapp, ''));
  normalized_car_model text := trim(coalesce(candidate_car_model, ''));
  normalized_message text := trim(coalesce(candidate_message, ''));
  created_application_id uuid;
begin
  if char_length(normalized_full_name) < 3
    or char_length(normalized_instagram) < 3
    or char_length(normalized_whatsapp) < 10
    or char_length(normalized_car_model) < 2 then
    raise exception 'Required application fields are missing.';
  end if;

  if candidate_identity_rule_confirmed is not true then
    raise exception 'Identity rule must be confirmed.';
  end if;

  if coalesce(candidate_image_url, '') = ''
    or coalesce(candidate_image_path, '') = ''
    or coalesce(candidate_member_photo_url, '') = ''
    or coalesce(candidate_member_photo_path, '') = '' then
    raise exception 'Application photos are required.';
  end if;

  insert into public.applications (
    full_name,
    instagram,
    whatsapp,
    car_model,
    car_setup,
    message,
    image_name,
    image_url,
    image_path,
    member_photo_url,
    member_photo_path,
    identity_rule_confirmed,
    status
  )
  values (
    left(normalized_full_name, 80),
    left(normalized_instagram, 31),
    left(normalized_whatsapp, 20),
    left(normalized_car_model, 80),
    null,
    nullif(left(normalized_message, 500), ''),
    left(coalesce(candidate_image_name, ''), 255),
    candidate_image_url,
    candidate_image_path,
    candidate_member_photo_url,
    candidate_member_photo_path,
    true,
    'pending'
  )
  returning id into created_application_id;

  return created_application_id;
end;
$$;

grant execute on function public.create_application(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) to anon, authenticated;

drop function if exists public.admin_approve_application(uuid);

create or replace function public.admin_approve_application(
  target_application_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record public.applications%rowtype;
  existing_member_id uuid;
  created_member_id uuid;
  next_member_number text;
  next_access_code text;
begin
  if not public.can_review_applications() then
    raise exception 'Admin access required.';
  end if;

  select *
  into application_record
  from public.applications
  where applications.id = target_application_id
  for update;

  if not found then
    raise exception 'Application not found.';
  end if;

  if application_record.identity_rule_confirmed is not true then
    raise exception 'Identity rule must be confirmed.';
  end if;

  select members.id
  into existing_member_id
  from public.members
  where members.application_id = target_application_id
  limit 1;

  if existing_member_id is not null then
    update public.applications
    set status = 'approved'
    where applications.id = target_application_id;

    perform public.write_admin_audit_log(
      'approve_application',
      'application',
      target_application_id,
      jsonb_build_object(
        'member_id', existing_member_id,
        'already_had_member', true,
        'previous_status', application_record.status
      )
    );

    return existing_member_id;
  end if;

  loop
    next_member_number := 'NFC-' || lpad(
      floor(random() * 1000000)::integer::text,
      6,
      '0'
    );

    exit when not exists (
      select 1
      from public.members
      where members.member_number = next_member_number
    );
  end loop;

  loop
    next_access_code := 'NFV-' || upper(substr(
      md5(random()::text || clock_timestamp()::text || target_application_id::text),
      1,
      8
    ));

    exit when not exists (
      select 1
      from public.members
      where members.access_code = next_access_code
    );
  end loop;

  insert into public.members (
    application_id,
    full_name,
    instagram,
    whatsapp,
    car_model,
    car_setup,
    image_url,
    member_photo_url,
    member_photo_path,
    access_code,
    role,
    status,
    member_number
  )
  values (
    application_record.id,
    application_record.full_name,
    application_record.instagram,
    application_record.whatsapp,
    application_record.car_model,
    application_record.car_setup,
    application_record.image_url,
    application_record.member_photo_url,
    application_record.member_photo_path,
    next_access_code,
    'member',
    'active',
    next_member_number
  )
  returning id into created_member_id;

  update public.applications
  set status = 'approved'
  where applications.id = target_application_id;

  perform public.write_admin_audit_log(
    'approve_application',
    'application',
    target_application_id,
    jsonb_build_object(
      'member_id', created_member_id,
      'member_number', next_member_number,
      'previous_status', application_record.status
    )
  );

  return created_member_id;
end;
$$;

grant execute on function public.admin_approve_application(uuid)
  to authenticated;

drop function if exists public.admin_reject_application(uuid);

create or replace function public.admin_reject_application(
  target_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record public.applications%rowtype;
  related_member_id uuid;
begin
  if not public.can_review_applications() then
    raise exception 'Admin access required.';
  end if;

  select *
  into application_record
  from public.applications
  where applications.id = target_application_id
  for update;

  if not found then
    raise exception 'Application not found.';
  end if;

  select members.id
  into related_member_id
  from public.members
  where members.application_id = target_application_id
  limit 1;

  if related_member_id is not null then
    if not public.can_manage_members() then
      raise exception 'Moderator cannot remove an already approved member.';
    end if;

    delete from public.members
    where members.id = related_member_id;
  end if;

  update public.applications
  set status = 'rejected'
  where applications.id = target_application_id;

  perform public.write_admin_audit_log(
    'reject_application',
    'application',
    target_application_id,
    jsonb_build_object(
      'previous_status', application_record.status,
      'removed_member_id', related_member_id
    )
  );
end;
$$;

grant execute on function public.admin_reject_application(uuid)
  to authenticated;

drop function if exists public.admin_delete_application(uuid);

create or replace function public.admin_delete_application(
  target_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record public.applications%rowtype;
  related_member_id uuid;
begin
  if not public.can_manage_members() then
    raise exception 'Manager access required.';
  end if;

  select *
  into application_record
  from public.applications
  where applications.id = target_application_id;

  if not found then
    raise exception 'Application not found.';
  end if;

  select members.id
  into related_member_id
  from public.members
  where members.application_id = target_application_id
  limit 1;

  if related_member_id is not null then
    delete from public.members
    where members.id = related_member_id;
  end if;

  delete from public.applications
  where applications.id = target_application_id;

  perform public.write_admin_audit_log(
    'delete_application',
    'application',
    target_application_id,
    jsonb_build_object(
      'full_name', application_record.full_name,
      'status', application_record.status,
      'removed_member_id', related_member_id
    )
  );
end;
$$;

grant execute on function public.admin_delete_application(uuid)
  to authenticated;

drop function if exists public.admin_update_member_role(uuid, text);

create or replace function public.admin_update_member_role(
  target_member_id uuid,
  next_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member_record public.members%rowtype;
  normalized_role text := lower(trim(coalesce(next_role, '')));
begin
  if not public.can_manage_members() then
    raise exception 'Manager access required.';
  end if;

  if normalized_role not in ('founder', 'admin', 'moderator', 'member') then
    raise exception 'Invalid member role.';
  end if;

  select *
  into member_record
  from public.members
  where members.id = target_member_id
  for update;

  if not found then
    raise exception 'Member not found.';
  end if;

  update public.members
  set role = normalized_role
  where members.id = target_member_id;

  perform public.write_admin_audit_log(
    'update_member_role',
    'member',
    target_member_id,
    jsonb_build_object(
      'full_name', member_record.full_name,
      'previous_role', member_record.role,
      'next_role', normalized_role
    )
  );
end;
$$;

grant execute on function public.admin_update_member_role(uuid, text)
  to authenticated;

drop function if exists public.admin_update_member_status(uuid, text);

create or replace function public.admin_update_member_status(
  target_member_id uuid,
  next_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member_record public.members%rowtype;
  normalized_status text := lower(trim(coalesce(next_status, '')));
begin
  if not public.can_manage_members() then
    raise exception 'Manager access required.';
  end if;

  if normalized_status not in ('active', 'inactive') then
    raise exception 'Invalid member status.';
  end if;

  select *
  into member_record
  from public.members
  where members.id = target_member_id
  for update;

  if not found then
    raise exception 'Member not found.';
  end if;

  update public.members
  set status = normalized_status
  where members.id = target_member_id;

  perform public.write_admin_audit_log(
    'update_member_status',
    'member',
    target_member_id,
    jsonb_build_object(
      'full_name', member_record.full_name,
      'previous_status', member_record.status,
      'next_status', normalized_status
    )
  );
end;
$$;

grant execute on function public.admin_update_member_status(uuid, text)
  to authenticated;

drop function if exists public.admin_delete_member(uuid);

create or replace function public.admin_delete_member(
  target_member_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  member_record public.members%rowtype;
  deleted_linked_application boolean := false;
begin
  if not public.can_manage_members() then
    raise exception 'Manager access required.';
  end if;

  select *
  into member_record
  from public.members
  where members.id = target_member_id;

  if not found then
    raise exception 'Member not found.';
  end if;

  delete from public.members
  where members.id = target_member_id;

  if member_record.application_id is not null then
    delete from public.applications
    where applications.id = member_record.application_id;

    deleted_linked_application := true;
  end if;

  perform public.write_admin_audit_log(
    'delete_member',
    'member',
    target_member_id,
    jsonb_build_object(
      'full_name', member_record.full_name,
      'member_number', member_record.member_number,
      'application_id', member_record.application_id,
      'deleted_linked_application', deleted_linked_application
    )
  );

  return deleted_linked_application;
end;
$$;

grant execute on function public.admin_delete_member(uuid)
  to authenticated;

drop function if exists public.admin_create_crew_event(
  text,
  text,
  text,
  timestamptz,
  text,
  integer
);

create or replace function public.admin_create_crew_event(
  event_title text,
  event_description text,
  event_location text,
  event_starts_at timestamptz,
  event_status text,
  event_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_title text := trim(coalesce(event_title, ''));
  normalized_status text := lower(trim(coalesce(event_status, 'open')));
  created_event_id uuid;
begin
  if not public.can_manage_members() then
    raise exception 'Manager access required.';
  end if;

  if char_length(normalized_title) < 2 then
    raise exception 'Event title is required.';
  end if;

  if normalized_status not in ('draft', 'open', 'closed', 'completed', 'cancelled') then
    raise exception 'Invalid event status.';
  end if;

  if event_capacity is not null and event_capacity <= 0 then
    raise exception 'Event capacity must be greater than zero.';
  end if;

  insert into public.crew_events (
    title,
    description,
    location,
    starts_at,
    status,
    capacity,
    created_by,
    updated_at
  )
  values (
    left(normalized_title, 120),
    nullif(left(trim(coalesce(event_description, '')), 700), ''),
    nullif(left(trim(coalesce(event_location, '')), 180), ''),
    event_starts_at,
    normalized_status,
    event_capacity,
    auth.uid(),
    now()
  )
  returning id into created_event_id;

  perform public.write_admin_audit_log(
    'create_crew_event',
    'crew_event',
    created_event_id,
    jsonb_build_object(
      'title', normalized_title,
      'status', normalized_status,
      'starts_at', event_starts_at
    )
  );

  return created_event_id;
end;
$$;

grant execute on function public.admin_create_crew_event(
  text,
  text,
  text,
  timestamptz,
  text,
  integer
) to authenticated;

drop function if exists public.admin_update_crew_event_status(uuid, text);

create or replace function public.admin_update_crew_event_status(
  target_event_id uuid,
  next_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  event_record public.crew_events%rowtype;
  normalized_status text := lower(trim(coalesce(next_status, '')));
begin
  if not public.can_manage_members() then
    raise exception 'Manager access required.';
  end if;

  if normalized_status not in ('draft', 'open', 'closed', 'completed', 'cancelled') then
    raise exception 'Invalid event status.';
  end if;

  select *
  into event_record
  from public.crew_events
  where crew_events.id = target_event_id
  for update;

  if not found then
    raise exception 'Event not found.';
  end if;

  update public.crew_events
  set status = normalized_status,
      updated_at = now()
  where crew_events.id = target_event_id;

  perform public.write_admin_audit_log(
    'update_crew_event_status',
    'crew_event',
    target_event_id,
    jsonb_build_object(
      'title', event_record.title,
      'previous_status', event_record.status,
      'next_status', normalized_status
    )
  );
end;
$$;

grant execute on function public.admin_update_crew_event_status(uuid, text)
  to authenticated;

drop function if exists public.admin_delete_crew_event(uuid);

create or replace function public.admin_delete_crew_event(
  target_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  event_record public.crew_events%rowtype;
begin
  if not public.can_manage_members() then
    raise exception 'Manager access required.';
  end if;

  select *
  into event_record
  from public.crew_events
  where crew_events.id = target_event_id;

  if not found then
    raise exception 'Event not found.';
  end if;

  delete from public.crew_events
  where crew_events.id = target_event_id;

  perform public.write_admin_audit_log(
    'delete_crew_event',
    'crew_event',
    target_event_id,
    jsonb_build_object(
      'title', event_record.title,
      'status', event_record.status,
      'starts_at', event_record.starts_at
    )
  );
end;
$$;

grant execute on function public.admin_delete_crew_event(uuid)
  to authenticated;

drop function if exists public.admin_reset_event_check_in(uuid, uuid);

create or replace function public.admin_reset_event_check_in(
  target_event_id uuid,
  target_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  event_title text;
  member_name text;
  previous_check_in timestamptz;
begin
  if not public.can_review_applications() then
    raise exception 'Admin access required.';
  end if;

  select crew_events.title
  into event_title
  from public.crew_events
  where crew_events.id = target_event_id;

  if event_title is null then
    raise exception 'Event not found.';
  end if;

  select members.full_name
  into member_name
  from public.members
  where members.id = target_member_id
    and members.status = 'active';

  if member_name is null then
    raise exception 'Active member not found.';
  end if;

  select event_rsvps.checked_in_at
  into previous_check_in
  from public.event_rsvps
  where event_rsvps.event_id = target_event_id
    and event_rsvps.member_id = target_member_id;

  if not found then
    raise exception 'RSVP not found.';
  end if;

  update public.event_rsvps
  set checked_in_at = null,
      updated_at = now()
  where event_rsvps.event_id = target_event_id
    and event_rsvps.member_id = target_member_id;

  perform public.write_admin_audit_log(
    'reset_event_check_in',
    'crew_event',
    target_event_id,
    jsonb_build_object(
      'title', event_title,
      'member_id', target_member_id,
      'member_name', member_name,
      'previous_check_in', previous_check_in
    )
  );
end;
$$;

grant execute on function public.admin_reset_event_check_in(uuid, uuid)
  to authenticated;

drop function if exists public.admin_delete_feed_post(uuid);

create or replace function public.admin_delete_feed_post(
  target_post_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  post_record public.feed_posts%rowtype;
begin
  if not public.can_review_applications() then
    raise exception 'Admin access required.';
  end if;

  select *
  into post_record
  from public.feed_posts
  where feed_posts.id = target_post_id;

  if not found then
    raise exception 'Post not found.';
  end if;

  delete from public.feed_posts
  where feed_posts.id = target_post_id;

  perform public.write_admin_audit_log(
    'delete_feed_post',
    'feed_post',
    target_post_id,
    jsonb_build_object(
      'member_id', post_record.member_id,
      'body_preview', left(post_record.body, 120)
    )
  );
end;
$$;

grant execute on function public.admin_delete_feed_post(uuid)
  to authenticated;

drop function if exists public.admin_delete_feed_comment(uuid);

create or replace function public.admin_delete_feed_comment(
  target_comment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  comment_record public.feed_comments%rowtype;
begin
  if not public.can_review_applications() then
    raise exception 'Admin access required.';
  end if;

  select *
  into comment_record
  from public.feed_comments
  where feed_comments.id = target_comment_id;

  if not found then
    raise exception 'Comment not found.';
  end if;

  delete from public.feed_comments
  where feed_comments.id = target_comment_id;

  perform public.write_admin_audit_log(
    'delete_feed_comment',
    'feed_comment',
    target_comment_id,
    jsonb_build_object(
      'post_id', comment_record.post_id,
      'member_id', comment_record.member_id,
      'body_preview', left(comment_record.body, 120)
    )
  );
end;
$$;

grant execute on function public.admin_delete_feed_comment(uuid)
  to authenticated;

drop function if exists public.admin_delete_chat_message(uuid);

create or replace function public.admin_delete_chat_message(
  target_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  message_record public.chat_messages%rowtype;
begin
  if not public.can_review_applications() then
    raise exception 'Admin access required.';
  end if;

  select *
  into message_record
  from public.chat_messages
  where chat_messages.id = target_message_id;

  if not found then
    raise exception 'Chat message not found.';
  end if;

  delete from public.chat_messages
  where chat_messages.id = target_message_id;

  perform public.write_admin_audit_log(
    'delete_chat_message',
    'chat_message',
    target_message_id,
    jsonb_build_object(
      'member_id', message_record.member_id,
      'body_preview', left(message_record.body, 120)
    )
  );
end;
$$;

grant execute on function public.admin_delete_chat_message(uuid)
  to authenticated;

drop function if exists public.authenticate_member(text);

create or replace function public.authenticate_member(secret_code text)
returns table (
  id uuid,
  full_name text,
  instagram text,
  car_model text,
  car_setup text,
  bio text,
  car_specs text,
  car_mods text,
  gallery_urls jsonb,
  image_url text,
  member_photo_url text,
  member_photo_path text,
  role text,
  member_number text,
  profile_updated_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    members.id,
    members.full_name,
    members.instagram,
    members.car_model,
    members.car_setup,
    members.bio,
    members.car_specs,
    members.car_mods,
    members.gallery_urls,
    members.image_url,
    members.member_photo_url,
    members.member_photo_path,
    members.role,
    members.member_number,
    members.profile_updated_at,
    members.created_at
  from public.members
  where members.status = 'active'
    and members.access_code = secret_code
  limit 1;
$$;

grant execute on function public.authenticate_member(text) to anon, authenticated;

drop function if exists public.list_active_members();
drop function if exists public.list_active_members(uuid, text);

create or replace function public.list_active_members(
  active_member_id uuid,
  secret_code text
)
returns table (
  id uuid,
  application_id uuid,
  full_name text,
  instagram text,
  car_model text,
  car_setup text,
  bio text,
  car_specs text,
  car_mods text,
  gallery_urls jsonb,
  image_url text,
  member_photo_url text,
  member_photo_path text,
  status text,
  role text,
  member_number text,
  profile_updated_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with active_session as (
    select members.id
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
    limit 1
  )
  select
    members.id,
    members.application_id,
    members.full_name,
    members.instagram,
    members.car_model,
    members.car_setup,
    members.bio,
    members.car_specs,
    members.car_mods,
    members.gallery_urls,
    members.image_url,
    members.member_photo_url,
    members.member_photo_path,
    members.status,
    members.role,
    members.member_number,
    members.profile_updated_at,
    members.created_at
  from public.members
  cross join active_session
  where members.status = 'active'
  order by members.created_at desc;
$$;

grant execute on function public.list_active_members(uuid, text)
  to anon, authenticated;

drop function if exists public.get_member_profile(uuid);

create or replace function public.get_member_profile(member_id uuid)
returns table (
  id uuid,
  application_id uuid,
  full_name text,
  instagram text,
  car_model text,
  car_setup text,
  bio text,
  car_specs text,
  car_mods text,
  gallery_urls jsonb,
  image_url text,
  member_photo_url text,
  member_photo_path text,
  role text,
  member_number text,
  profile_updated_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    members.id,
    members.application_id,
    members.full_name,
    members.instagram,
    members.car_model,
    members.car_setup,
    members.bio,
    members.car_specs,
    members.car_mods,
    members.gallery_urls,
    members.image_url,
    members.member_photo_url,
    members.member_photo_path,
    members.role,
    members.member_number,
    members.profile_updated_at,
    members.created_at
  from public.members
  where members.id = member_id
    and members.status = 'active'
  limit 1;
$$;

grant execute on function public.get_member_profile(uuid) to authenticated;

drop function if exists public.validate_member_session(uuid, text);

create or replace function public.validate_member_session(
  active_member_id uuid,
  secret_code text
)
returns table (
  id uuid,
  application_id uuid,
  full_name text,
  instagram text,
  car_model text,
  car_setup text,
  bio text,
  car_specs text,
  car_mods text,
  gallery_urls jsonb,
  image_url text,
  member_photo_url text,
  member_photo_path text,
  role text,
  member_number text,
  profile_updated_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    members.id,
    members.application_id,
    members.full_name,
    members.instagram,
    members.car_model,
    members.car_setup,
    members.bio,
    members.car_specs,
    members.car_mods,
    members.gallery_urls,
    members.image_url,
    members.member_photo_url,
    members.member_photo_path,
    members.role,
    members.member_number,
    members.profile_updated_at,
    members.created_at
  from public.members
  where members.id = active_member_id
    and members.status = 'active'
    and members.access_code = secret_code
  limit 1;
$$;

grant execute on function public.validate_member_session(uuid, text)
  to anon, authenticated;

drop function if exists public.update_member_profile(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
);

create or replace function public.update_member_profile(
  active_member_id uuid,
  secret_code text,
  profile_bio text,
  profile_instagram text,
  profile_car_model text,
  profile_car_setup text,
  profile_car_specs text,
  profile_car_mods text,
  profile_gallery_urls jsonb
)
returns table (
  id uuid,
  application_id uuid,
  full_name text,
  instagram text,
  car_model text,
  car_setup text,
  bio text,
  car_specs text,
  car_mods text,
  gallery_urls jsonb,
  image_url text,
  member_photo_url text,
  member_photo_path text,
  role text,
  member_number text,
  profile_updated_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_gallery jsonb := coalesce(profile_gallery_urls, '[]'::jsonb);
begin
  if jsonb_typeof(normalized_gallery) <> 'array' then
    raise exception 'Gallery must be an array.';
  end if;

  if jsonb_array_length(normalized_gallery) > 6 then
    raise exception 'Gallery can have at most 6 images.';
  end if;

  return query
  update public.members
  set
    bio = nullif(left(trim(coalesce(profile_bio, '')), 500), ''),
    instagram = nullif(left(trim(coalesce(profile_instagram, '')), 31), ''),
    car_model = nullif(left(trim(coalesce(profile_car_model, '')), 80), ''),
    car_setup = nullif(left(trim(coalesce(profile_car_setup, '')), 700), ''),
    car_specs = nullif(left(trim(coalesce(profile_car_specs, '')), 700), ''),
    car_mods = nullif(left(trim(coalesce(profile_car_mods, '')), 700), ''),
    gallery_urls = normalized_gallery,
    profile_updated_at = now()
  where members.id = active_member_id
    and members.status = 'active'
    and members.access_code = secret_code
  returning
    members.id,
    members.application_id,
    members.full_name,
    members.instagram,
    members.car_model,
    members.car_setup,
    members.bio,
    members.car_specs,
    members.car_mods,
    members.gallery_urls,
    members.image_url,
    members.member_photo_url,
    members.member_photo_path,
    members.role,
    members.member_number,
    members.profile_updated_at,
    members.created_at;

  if not found then
    raise exception 'Active member not found.';
  end if;
end;
$$;

grant execute on function public.update_member_profile(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to anon, authenticated;

drop function if exists public.verify_member(uuid);

create or replace function public.verify_member(member_id uuid)
returns table (
  id uuid,
  full_name text,
  instagram text,
  car_model text,
  role text,
  member_number text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    members.id,
    members.full_name,
    members.instagram,
    members.car_model,
    members.role,
    members.member_number,
    members.created_at
  from public.members
  where members.id = member_id
    and members.status = 'active'
  limit 1;
$$;

grant execute on function public.verify_member(uuid) to anon, authenticated;

drop function if exists public.list_chat_messages();
drop function if exists public.list_chat_messages(uuid, text);

create or replace function public.list_chat_messages(
  active_member_id uuid,
  secret_code text
)
returns table (
  id uuid,
  member_id uuid,
  body text,
  created_at timestamptz,
  member_full_name text,
  member_number text,
  member_role text
)
language sql
security definer
set search_path = public
as $$
  with active_session as (
    select members.id
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
    limit 1
  )
  select
    chat_messages.id,
    chat_messages.member_id,
    chat_messages.body,
    chat_messages.created_at,
    members.full_name as member_full_name,
    members.member_number,
    members.role as member_role
  from public.chat_messages
  join public.members on members.id = chat_messages.member_id
  cross join active_session
  where members.status = 'active'
  order by chat_messages.created_at asc
  limit 100;
$$;

grant execute on function public.list_chat_messages(uuid, text)
  to anon, authenticated;

drop function if exists public.create_chat_message(uuid, text);

create or replace function public.create_chat_message(
  active_member_id uuid,
  secret_code text,
  message_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_body text := trim(coalesce(message_body, ''));
  created_message_id uuid;
begin
  if char_length(normalized_body) < 1
    or char_length(normalized_body) > 500 then
    raise exception 'Chat message must be between 1 and 500 characters.';
  end if;

  if not exists (
    select 1
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
  ) then
    raise exception 'Active member not found.';
  end if;

  insert into public.chat_messages (member_id, body)
  values (active_member_id, normalized_body)
  returning id into created_message_id;

  return created_message_id;
end;
$$;

grant execute on function public.create_chat_message(uuid, text, text)
  to anon, authenticated;

drop function if exists public.list_feed_posts(uuid, text);

create or replace function public.list_feed_posts(
  active_member_id uuid,
  secret_code text
)
returns table (
  id uuid,
  member_id uuid,
  body text,
  image_urls jsonb,
  created_at timestamptz,
  author_name text,
  author_member_number text,
  author_role text,
  author_car_model text,
  author_member_photo_url text,
  like_count bigint,
  comment_count bigint,
  liked_by_current_member boolean,
  comments jsonb
)
language sql
security definer
set search_path = public
as $$
  with active_session as (
    select members.id
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
    limit 1
  )
  select
    feed_posts.id,
    feed_posts.member_id,
    feed_posts.body,
    feed_posts.image_urls,
    feed_posts.created_at,
    members.full_name as author_name,
    members.member_number as author_member_number,
    members.role as author_role,
    members.car_model as author_car_model,
    members.member_photo_url as author_member_photo_url,
    (
      select count(*)
      from public.feed_likes
      where feed_likes.post_id = feed_posts.id
    ) as like_count,
    (
      select count(*)
      from public.feed_comments
      where feed_comments.post_id = feed_posts.id
    ) as comment_count,
    exists (
      select 1
      from public.feed_likes
      where feed_likes.post_id = feed_posts.id
        and feed_likes.member_id = active_member_id
    ) as liked_by_current_member,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', feed_comments.id,
            'member_id', feed_comments.member_id,
            'body', feed_comments.body,
            'created_at', feed_comments.created_at,
            'author_name', comment_members.full_name,
            'author_member_number', comment_members.member_number,
            'author_role', comment_members.role
          )
          order by feed_comments.created_at asc
        ),
        '[]'::jsonb
      )
      from public.feed_comments
      join public.members as comment_members
        on comment_members.id = feed_comments.member_id
      where feed_comments.post_id = feed_posts.id
        and comment_members.status = 'active'
    ) as comments
  from public.feed_posts
  join public.members on members.id = feed_posts.member_id
  cross join active_session
  where members.status = 'active'
  order by feed_posts.created_at desc
  limit 50;
$$;

grant execute on function public.list_feed_posts(uuid, text)
  to anon, authenticated;

drop function if exists public.create_feed_post(uuid, text, text, jsonb);

create or replace function public.create_feed_post(
  active_member_id uuid,
  secret_code text,
  post_body text,
  post_image_urls jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_body text := left(trim(coalesce(post_body, '')), 700);
  normalized_images jsonb := coalesce(post_image_urls, '[]'::jsonb);
  created_post_id uuid;
begin
  if not exists (
    select 1
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
  ) then
    raise exception 'Active member not found.';
  end if;

  if jsonb_typeof(normalized_images) <> 'array' then
    raise exception 'Post images must be an array.';
  end if;

  if jsonb_array_length(normalized_images) > 4 then
    raise exception 'Feed post can have at most 4 images.';
  end if;

  if char_length(normalized_body) < 1
    and jsonb_array_length(normalized_images) < 1 then
    raise exception 'Post must have text or image.';
  end if;

  insert into public.feed_posts (member_id, body, image_urls)
  values (active_member_id, normalized_body, normalized_images)
  returning id into created_post_id;

  return created_post_id;
end;
$$;

grant execute on function public.create_feed_post(uuid, text, text, jsonb)
  to anon, authenticated;

drop function if exists public.toggle_feed_like(uuid, text, uuid);

create or replace function public.toggle_feed_like(
  active_member_id uuid,
  secret_code text,
  target_post_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
  ) then
    raise exception 'Active member not found.';
  end if;

  if not exists (
    select 1
    from public.feed_posts
    where feed_posts.id = target_post_id
  ) then
    raise exception 'Post not found.';
  end if;

  if exists (
    select 1
    from public.feed_likes
    where feed_likes.post_id = target_post_id
      and feed_likes.member_id = active_member_id
  ) then
    delete from public.feed_likes
    where feed_likes.post_id = target_post_id
      and feed_likes.member_id = active_member_id;

    return false;
  end if;

  insert into public.feed_likes (post_id, member_id)
  values (target_post_id, active_member_id);

  return true;
end;
$$;

grant execute on function public.toggle_feed_like(uuid, text, uuid)
  to anon, authenticated;

drop function if exists public.create_feed_comment(uuid, text, uuid, text);

create or replace function public.create_feed_comment(
  active_member_id uuid,
  secret_code text,
  target_post_id uuid,
  comment_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_body text := left(trim(coalesce(comment_body, '')), 400);
  created_comment_id uuid;
begin
  if char_length(normalized_body) < 1 then
    raise exception 'Comment cannot be empty.';
  end if;

  if not exists (
    select 1
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
  ) then
    raise exception 'Active member not found.';
  end if;

  if not exists (
    select 1
    from public.feed_posts
    where feed_posts.id = target_post_id
  ) then
    raise exception 'Post not found.';
  end if;

  insert into public.feed_comments (post_id, member_id, body)
  values (target_post_id, active_member_id, normalized_body)
  returning id into created_comment_id;

  return created_comment_id;
end;
$$;

grant execute on function public.create_feed_comment(uuid, text, uuid, text)
  to anon, authenticated;

drop function if exists public.list_member_events(uuid, text);

create or replace function public.list_member_events(
  active_member_id uuid,
  secret_code text
)
returns table (
  id uuid,
  title text,
  description text,
  location text,
  starts_at timestamptz,
  status text,
  capacity integer,
  created_at timestamptz,
  attendee_count bigint,
  checked_in_count bigint,
  current_member_rsvp_status text,
  current_member_checked_in_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with active_session as (
    select members.id
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
    limit 1
  )
  select
    crew_events.id,
    crew_events.title,
    crew_events.description,
    crew_events.location,
    crew_events.starts_at,
    crew_events.status,
    crew_events.capacity,
    crew_events.created_at,
    (
      select count(*)
      from public.event_rsvps
      where event_rsvps.event_id = crew_events.id
        and event_rsvps.status = 'going'
    ) as attendee_count,
    (
      select count(*)
      from public.event_rsvps
      where event_rsvps.event_id = crew_events.id
        and event_rsvps.status = 'going'
        and event_rsvps.checked_in_at is not null
    ) as checked_in_count,
    current_rsvp.status as current_member_rsvp_status,
    current_rsvp.checked_in_at as current_member_checked_in_at
  from public.crew_events
  cross join active_session
  left join public.event_rsvps as current_rsvp
    on current_rsvp.event_id = crew_events.id
    and current_rsvp.member_id = active_member_id
  where crew_events.status in ('open', 'closed', 'completed')
  order by crew_events.starts_at asc nulls last, crew_events.created_at desc;
$$;

grant execute on function public.list_member_events(uuid, text)
  to anon, authenticated;

drop function if exists public.set_event_rsvp(uuid, text, uuid, text);

create or replace function public.set_event_rsvp(
  active_member_id uuid,
  secret_code text,
  target_event_id uuid,
  rsvp_status text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(trim(coalesce(rsvp_status, 'going')));
  event_status text;
  current_capacity integer;
  attendee_count integer;
begin
  if normalized_status not in ('going', 'not_going') then
    raise exception 'Invalid RSVP status.';
  end if;

  if not exists (
    select 1
    from public.members
    where members.id = active_member_id
      and members.status = 'active'
      and members.access_code = secret_code
  ) then
    raise exception 'Active member not found.';
  end if;

  select crew_events.status, crew_events.capacity
  into event_status, current_capacity
  from public.crew_events
  where crew_events.id = target_event_id;

  if event_status is null then
    raise exception 'Event not found.';
  end if;

  if event_status <> 'open' then
    raise exception 'Event is not open for RSVP.';
  end if;

  if normalized_status = 'going'
    and current_capacity is not null
    and not exists (
      select 1
      from public.event_rsvps
      where event_rsvps.event_id = target_event_id
        and event_rsvps.member_id = active_member_id
        and event_rsvps.status = 'going'
    ) then
    select count(*)::integer
    into attendee_count
    from public.event_rsvps
    where event_rsvps.event_id = target_event_id
      and event_rsvps.status = 'going';

    if attendee_count >= current_capacity then
      raise exception 'Event capacity reached.';
    end if;
  end if;

  insert into public.event_rsvps (
    event_id,
    member_id,
    status,
    checked_in_at,
    updated_at
  )
  values (
    target_event_id,
    active_member_id,
    normalized_status,
    null,
    now()
  )
  on conflict (event_id, member_id) do update
  set status = excluded.status,
      checked_in_at = case
        when excluded.status = 'not_going' then null
        else public.event_rsvps.checked_in_at
      end,
      updated_at = now();

  return normalized_status;
end;
$$;

grant execute on function public.set_event_rsvp(uuid, text, uuid, text)
  to anon, authenticated;

drop function if exists public.check_in_event_member(uuid, uuid);

create or replace function public.check_in_event_member(
  target_event_id uuid,
  target_member_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  checkin_time timestamptz := now();
begin
  if not public.can_review_applications() then
    raise exception 'Admin access required.';
  end if;

  if not exists (
    select 1
    from public.crew_events
    where crew_events.id = target_event_id
      and crew_events.status in ('open', 'closed', 'completed')
  ) then
    raise exception 'Event not found.';
  end if;

  if not exists (
    select 1
    from public.members
    where members.id = target_member_id
      and members.status = 'active'
  ) then
    raise exception 'Active member not found.';
  end if;

  insert into public.event_rsvps (
    event_id,
    member_id,
    status,
    checked_in_at,
    updated_at
  )
  values (
    target_event_id,
    target_member_id,
    'going',
    checkin_time,
    now()
  )
  on conflict (event_id, member_id) do update
  set status = 'going',
      checked_in_at = coalesce(public.event_rsvps.checked_in_at, checkin_time),
      updated_at = now()
  returning checked_in_at into checkin_time;

  perform public.write_admin_audit_log(
    'check_in_event_member',
    'crew_event',
    target_event_id,
    jsonb_build_object(
      'member_id', target_member_id,
      'checked_in_at', checkin_time
    )
  );

  return checkin_time;
end;
$$;

grant execute on function public.check_in_event_member(uuid, uuid)
  to authenticated;

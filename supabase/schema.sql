-- LAYOVER v0.2 — run ONCE in Supabase SQL Editor on a NEW project.
-- These policies matter: do not remove RLS or expose a service_role/secret key.
create extension if not exists pgcrypto;

create type public.group_role as enum ('owner', 'admin', 'member');
create type public.invite_status as enum ('pending', 'accepted', 'declined');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default 'Traveler' check (char_length(display_name) between 1 and 60),
  home_country text not null default '' check (char_length(home_country) <= 60),
  bio text not null default '' check (char_length(bio) <= 300),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 250),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 3 and 70),
  description text not null default '' check (char_length(description) <= 250),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members(user_id);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id),
  status public.invite_status not null default 'pending',
  created_at timestamptz not null default now()
);
create unique index one_pending_invite on public.group_invites(group_id, invited_user_id) where status='pending';
create index group_invites_target_idx on public.group_invites(invited_user_id, status);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_group_created_idx on public.messages(group_id,created_at desc);

create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  reported_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('harassment','spam','privacy','other')),
  created_at timestamptz not null default now(),
  unique(message_id,reported_by)
);

-- The auth service owns creation of profiles; signed-in users may only edit their own fields.
create function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    'traveler_' || left(replace(new.id::text,'-',''),12),
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Traveler'),60)
  ) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_profile_for_user();

-- Security definer helpers intentionally avoid recursively querying member RLS.
create function public.is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id=gid and m.user_id=(select auth.uid()));
$$;
create function public.is_group_admin(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id=gid and m.user_id=(select auth.uid()) and m.role in ('owner','admin'));
$$;
create function public.has_group_invite(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_invites i where i.group_id=gid and i.invited_user_id=(select auth.uid()) and i.status='pending');
$$;
create function public.is_group_owner(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id=gid and m.user_id=(select auth.uid()) and m.role='owner');
$$;

-- Every new group receives exactly one owner. Client cannot grant owner itself.
create function public.seed_group_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end $$;
create trigger group_owner_after_insert after insert on public.groups
for each row execute function public.seed_group_owner();

-- Accepting an invitation creates membership server-side, never client-side.
create function public.accept_group_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    insert into public.group_members (group_id, user_id, role)
    values (new.group_id, new.invited_user_id, 'member')
    on conflict (group_id,user_id) do nothing;
  end if;
  return new;
end $$;
create trigger group_invite_after_update after update of status on public.group_invites
for each row execute function public.accept_group_invite();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.messages enable row level security;
alter table public.message_reports enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_self_edit on public.profiles for update to authenticated
  using (id=(select auth.uid())) with check (id=(select auth.uid()));

create policy groups_members_read on public.groups for select to authenticated
  using (public.is_group_member(id) or public.has_group_invite(id));
create policy groups_user_create on public.groups for insert to authenticated
  with check (created_by=(select auth.uid()));
create policy groups_admin_edit on public.groups for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));
create policy groups_owner_delete on public.groups for delete to authenticated
  using (public.is_group_owner(id));

create policy group_members_read on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy group_members_roles on public.group_members for update to authenticated
  using (public.is_group_admin(group_id) and role <> 'owner' and user_id <> (select auth.uid()))
  with check (public.is_group_admin(group_id) and role in ('member','admin') and user_id <> (select auth.uid()));
create policy group_members_leave_or_remove on public.group_members for delete to authenticated
  using (role <> 'owner' and (user_id=(select auth.uid()) or public.is_group_admin(group_id)));

create policy invites_visible on public.group_invites for select to authenticated
  using (invited_user_id=(select auth.uid()) or public.is_group_admin(group_id));
create policy invites_admin_create on public.group_invites for insert to authenticated
  with check (
    invited_by=(select auth.uid()) and public.is_group_admin(group_id)
    and invited_user_id<>(select auth.uid()) and status='pending'
    and not exists (select 1 from public.group_members gm where gm.group_id=group_invites.group_id and gm.user_id=group_invites.invited_user_id)
  );
create policy invites_recipient_response on public.group_invites for update to authenticated
  using (invited_user_id=(select auth.uid()) and status='pending')
  with check (invited_user_id=(select auth.uid()) and status in ('accepted','declined'));

create policy messages_member_read on public.messages for select to authenticated
  using (public.is_group_member(group_id));
create policy messages_member_send on public.messages for insert to authenticated
  with check (user_id=(select auth.uid()) and public.is_group_member(group_id));

create policy reports_member_create on public.message_reports for insert to authenticated
  with check (
    reported_by=(select auth.uid()) and public.is_group_member(group_id)
    and exists (select 1 from public.messages m where m.id=message_id and m.group_id=message_reports.group_id)
  );

-- Restrict updateable columns (RLS alone doesn't stop changing IDs, roles, etc.).
revoke all on public.profiles, public.groups, public.group_members,
  public.group_invites, public.messages, public.message_reports from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username,display_name,home_country,bio,avatar_path) on public.profiles to authenticated;
grant select on public.groups to authenticated;
grant insert (name,description,created_by), update (name,description), delete on public.groups to authenticated;
grant select, delete on public.group_members to authenticated;
grant update (role) on public.group_members to authenticated;
grant select on public.group_invites to authenticated;
grant insert (group_id,invited_user_id,invited_by), update (status) on public.group_invites to authenticated;
grant select on public.messages to authenticated;
grant insert (group_id,user_id,body) on public.messages to authenticated;
grant insert (message_id,group_id,reported_by,reason) on public.message_reports to authenticated;
-- Avoid direct API calls using privileged SQL helpers by keeping grants to authenticated only.
revoke all on function public.is_group_member(uuid), public.is_group_admin(uuid), public.is_group_owner(uuid), public.has_group_invite(uuid) from public, anon;
grant execute on function public.is_group_member(uuid), public.is_group_admin(uuid), public.is_group_owner(uuid), public.has_group_invite(uuid) to authenticated;
revoke all on function public.create_profile_for_user(), public.seed_group_owner(), public.accept_group_invite() from public, anon, authenticated;

-- Avatars: private objects; authenticated users can sign short-lived URLs.
-- Paths are <own-user-id>/<random-uuid>.jpg and cannot be written to another user's folder.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',false,3145728,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=3145728,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy avatar_read_logged_in on storage.objects for select to authenticated
  using (bucket_id='avatars');
create policy avatar_upload_own_folder on storage.objects for insert to authenticated
  with check (bucket_id='avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatar_delete_own_folder on storage.objects for delete to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Minimal-scale live chat; migrate to Realtime Broadcast when traffic grows.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

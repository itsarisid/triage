-- 1. Workspaces
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
alter table public.workspaces enable row level security;

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
grant select, insert, update, delete on public.workspace_members to authenticated;
grant all on public.workspace_members to service_role;
alter table public.workspace_members enable row level security;

-- 2. Helper functions (security definer, no recursion)
create or replace function public.is_workspace_member(_workspace_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = _workspace_id and m.user_id = _user_id)
$$;

create or replace function public.is_workspace_admin(_workspace_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspaces w where w.id = _workspace_id and w.owner_id = _user_id
  ) or exists (
    select 1 from public.workspace_members m
    where m.workspace_id = _workspace_id and m.user_id = _user_id and m.role in ('owner','admin')
  )
$$;

create or replace function public.my_workspace_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select workspace_id from public.workspace_members where user_id = auth.uid()
$$;

create or replace function public.shares_workspace(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = _user_id
  )
$$;

-- 3. Scope existing data
alter table public.bugs add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.projects add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.invitations add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.invitations add column if not exists token text;

do $$
declare ws uuid; first_user uuid;
begin
  select user_id into first_user from public.profiles order by created_at asc limit 1;
  if first_user is null then return; end if;
  select id into ws from public.workspaces limit 1;
  if ws is null then
    insert into public.workspaces (name, owner_id) values ('Triage', first_user) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role)
      select ws, p.user_id, case when p.user_id = first_user then 'owner' else 'member' end from public.profiles p
      on conflict do nothing;
  end if;
  update public.bugs set workspace_id = ws where workspace_id is null;
  update public.projects set workspace_id = ws where workspace_id is null;
  update public.invitations set workspace_id = ws where workspace_id is null;
end $$;

update public.invitations set token = encode(gen_random_bytes(16), 'hex') where token is null;
alter table public.invitations alter column token set default encode(gen_random_bytes(16), 'hex');
create unique index if not exists invitations_token_key on public.invitations(token);
create index if not exists bugs_workspace_idx on public.bugs(workspace_id);

-- 4. Bug access helper
create or replace function public.can_access_bug(_bug_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bugs b
    join public.workspace_members m on m.workspace_id = b.workspace_id
    where b.id = _bug_id and m.user_id = _user_id
  )
$$;

-- 5. Accept invitation
create or replace function public.accept_invitation(_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invitations%rowtype; uid uuid := auth.uid(); em text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select lower(coalesce(auth.jwt() ->> 'email','')) into em;
  select * into inv from public.invitations where token = _token;
  if inv.id is null then raise exception 'Invitation not found'; end if;
  if inv.status <> 'pending' then raise exception 'Invitation is no longer valid'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception 'Invitation has expired'; end if;
  if lower(inv.email) <> em then raise exception 'This invitation was sent to a different email address'; end if;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, uid, 'member') on conflict (workspace_id, user_id) do nothing;
  update public.invitations set status = 'accepted' where id = inv.id;
  return inv.workspace_id;
end $$;

create or replace function public.invitation_preview(_token text)
returns table (workspace_name text, email text, status text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.name, i.email, i.status, i.expires_at
  from public.invitations i join public.workspaces w on w.id = i.workspace_id
  where i.token = _token
$$;

create or replace function public.create_workspace(_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ws uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  insert into public.workspaces (name, owner_id) values (coalesce(nullif(trim(_name),''),'My Workspace'), uid) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, uid, 'owner');
  return ws;
end $$;

revoke all on function public.is_workspace_member(uuid,uuid), public.is_workspace_admin(uuid,uuid),
  public.my_workspace_ids(), public.shares_workspace(uuid), public.can_access_bug(uuid,uuid),
  public.accept_invitation(text), public.invitation_preview(text), public.create_workspace(text) from public, anon;
grant execute on function public.is_workspace_member(uuid,uuid), public.is_workspace_admin(uuid,uuid),
  public.my_workspace_ids(), public.shares_workspace(uuid), public.can_access_bug(uuid,uuid),
  public.accept_invitation(text), public.invitation_preview(text), public.create_workspace(text) to authenticated;

-- 6. RLS policies
create policy "Members can view their workspaces" on public.workspaces for select to authenticated
  using (public.is_workspace_member(id, auth.uid()));
create policy "Users can create workspaces" on public.workspaces for insert to authenticated
  with check (owner_id = auth.uid());
create policy "Owners can update workspaces" on public.workspaces for update to authenticated
  using (owner_id = auth.uid());
create policy "Owners can delete workspaces" on public.workspaces for delete to authenticated
  using (owner_id = auth.uid());

create policy "Members can view workspace members" on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Admins can add members" on public.workspace_members for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "Admins or self can remove members" on public.workspace_members for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()) or user_id = auth.uid());

-- bugs
drop policy if exists "Bugs viewable by authenticated" on public.bugs;
drop policy if exists "Authenticated can create bugs" on public.bugs;
drop policy if exists "Reporter or assignee can update bugs" on public.bugs;
drop policy if exists "Admins can delete bugs" on public.bugs;
create policy "Workspace members can view bugs" on public.bugs for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Workspace members can create bugs" on public.bugs for insert to authenticated
  with check (auth.uid() = reporter_id and public.is_workspace_member(workspace_id, auth.uid()));
create policy "Workspace members can update bugs" on public.bugs for update to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Workspace admins can delete bugs" on public.bugs for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

-- comments
drop policy if exists "Comments viewable by authenticated" on public.comments;
drop policy if exists "Authenticated can create comments" on public.comments;
create policy "Workspace members can view comments" on public.comments for select to authenticated
  using (public.can_access_bug(bug_id, auth.uid()));
create policy "Workspace members can create comments" on public.comments for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_bug(bug_id, auth.uid()));

-- attachments
drop policy if exists "Attachments viewable by authenticated" on public.attachments;
drop policy if exists "Authenticated can upload attachments" on public.attachments;
create policy "Workspace members can view attachments" on public.attachments for select to authenticated
  using (public.can_access_bug(bug_id, auth.uid()));
create policy "Workspace members can add attachments" on public.attachments for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_bug(bug_id, auth.uid()));

-- activity log
drop policy if exists "Activity viewable by authenticated" on public.activity_log;
create policy "Workspace members can view activity" on public.activity_log for select to authenticated
  using (bug_id is null and user_id = auth.uid() or public.can_access_bug(bug_id, auth.uid()));

-- projects
drop policy if exists "Projects viewable by authenticated" on public.projects;
drop policy if exists "Admins can manage projects" on public.projects;
create policy "Workspace members can view projects" on public.projects for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Workspace admins can manage projects" on public.projects for all to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

-- profiles: only self or teammates
drop policy if exists "Profiles viewable by authenticated users" on public.profiles;
create policy "Self or teammates can view profiles" on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.shares_workspace(user_id));

-- invitations: workspace scoped
drop policy if exists "Inviter or admin can view invitations" on public.invitations;
drop policy if exists "Authenticated can create invitations" on public.invitations;
drop policy if exists "Inviter or admin can delete invitations" on public.invitations;
create policy "Workspace members can view invitations" on public.invitations for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Workspace admins can create invitations" on public.invitations for insert to authenticated
  with check (auth.uid() = invited_by and public.is_workspace_admin(workspace_id, auth.uid()));
create policy "Workspace admins can delete invitations" on public.invitations for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
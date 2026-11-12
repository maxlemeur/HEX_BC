-- Assistant conversations: a member asks questions about an affaire they can read, and
-- the assistant answers from what that member may read. A conversation is private to
-- the member who opened it: neither an admin nor the affaire's other readers see it.
-- It stops being readable when its author can no longer read the affaire.

create table public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  project_id uuid not null,
  title text not null,
  -- The affaire is in the conversation's tenant, and messages name the same author.
  constraint assistant_threads_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects(id, tenant_id) on delete cascade,
  constraint assistant_threads_author_key unique (id, tenant_id, user_id),
  constraint assistant_threads_title_check check (char_length(btrim(title)) between 1 and 120)
);
create index assistant_threads_author_project_idx
  on public.assistant_threads (tenant_id, user_id, project_id, updated_at desc);
create index assistant_threads_project_idx on public.assistant_threads (project_id, tenant_id);
create index assistant_threads_user_idx on public.assistant_threads (user_id);

-- Messages are written once: the question when it is sent, the answer when it ends,
-- whether complete, interrupted by the member or failed.
create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  thread_id uuid not null,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  role text not null,
  status text not null default 'complete',
  content text not null,
  -- What the assistant read to answer: [{ name, activity, ok }].
  activity jsonb not null default '[]'::jsonb,
  -- Where the member was when asking: { screen, versionId, lineId, jobId }.
  screen_context jsonb,
  model text,
  token_usage jsonb,
  error_code text,
  constraint assistant_messages_thread_fkey foreign key (thread_id, tenant_id, user_id)
    references public.assistant_threads(id, tenant_id, user_id) on delete cascade,
  constraint assistant_messages_role_check check (role in ('user', 'assistant')),
  constraint assistant_messages_status_check check (status in ('complete', 'interrupted', 'failed')),
  constraint assistant_messages_question_check check (role = 'assistant' or status = 'complete'),
  constraint assistant_messages_content_check
    check (char_length(content) <= 60000 and (status <> 'complete' or char_length(btrim(content)) > 0)),
  constraint assistant_messages_activity_check
    check (jsonb_typeof(activity) = 'array' and octet_length(activity::text) <= 20000),
  constraint assistant_messages_screen_context_check
    check (screen_context is null or (jsonb_typeof(screen_context) = 'object' and octet_length(screen_context::text) <= 2000)),
  constraint assistant_messages_token_usage_check
    check (token_usage is null or (jsonb_typeof(token_usage) = 'object' and octet_length(token_usage::text) <= 2000)),
  constraint assistant_messages_model_check check (model is null or char_length(model) between 1 and 120),
  constraint assistant_messages_error_code_check check (error_code is null or error_code ~ '^[A-Z0-9_]{1,64}$')
);
create index assistant_messages_thread_idx on public.assistant_messages (thread_id, created_at, id);
create index assistant_messages_tenant_idx on public.assistant_messages (tenant_id);
create index assistant_messages_user_idx on public.assistant_messages (user_id);

create function private.enforce_assistant_thread_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.user_id is distinct from old.user_id
    or new.project_id is distinct from old.project_id then
    raise exception using errcode = '23514', message = 'ASSISTANT_THREAD_SCOPE_IMMUTABLE';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

-- The author may only rename a conversation: its last activity is set here, as the owner.
create function private.touch_assistant_thread()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.assistant_threads set updated_at = now() where id = new.thread_id;
  return null;
end;
$$;

revoke all on function private.enforce_assistant_thread_write() from public, anon, authenticated;
revoke all on function private.touch_assistant_thread() from public, anon, authenticated;

create trigger enforce_assistant_thread_write
  before update on public.assistant_threads
  for each row execute function private.enforce_assistant_thread_write();
create trigger touch_assistant_thread
  after insert on public.assistant_messages
  for each row execute function private.touch_assistant_thread();

alter table public.assistant_threads enable row level security;
alter table public.assistant_threads force row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_messages force row level security;

revoke all on public.assistant_threads, public.assistant_messages from public, anon, authenticated;
grant select, insert, update, delete on public.assistant_threads to authenticated;
grant select, insert on public.assistant_messages to authenticated;
grant select, insert, update, delete on public.assistant_threads, public.assistant_messages to service_role;

create policy "Authors read their assistant conversations"
  on public.assistant_threads for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id)));
create policy "Affaire readers open assistant conversations"
  on public.assistant_threads for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id)));
create policy "Authors rename their assistant conversations"
  on public.assistant_threads for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id)))
  with check (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id)));
create policy "Authors delete their assistant conversations"
  on public.assistant_threads for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));

-- A message follows its conversation: the subquery reads assistant_threads under the
-- policies above, so it also requires that the author still reads the affaire.
create policy "Authors read their assistant messages"
  on public.assistant_messages for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid())
    and exists (select 1 from public.assistant_threads thread where thread.id = thread_id));
create policy "Authors write in their assistant conversations"
  on public.assistant_messages for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid())
    and exists (select 1 from public.assistant_threads thread where thread.id = thread_id));

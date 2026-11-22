-- TI-691, consultation message. No remote application is authorized here.
-- The message the office copies into WhatsApp to ask a supplier for a price follows, in this order, the member's
-- own template, the company's general template, then today's built-in message
-- (src/lib/material-requests/consultation-template.ts). Recorded consultations keep their text.
--
-- 1. public.material_request_message_templates: one row per membership (tenant, member), which nobody else reads
--    or changes, an admin included. message_template is the whole message, line_template what is written for each
--    line. Bounded to 2000 and 300 characters, never blank: with each field written once at most (checked by the
--    application), a line adds at most 300 characters to today's message.
--    - The keys are the database's: at insert the member is auth.uid() and the tenant public.current_tenant_id(),
--      whatever the caller sent; afterwards they never change (MATERIAL_REQUEST_MESSAGE_TEMPLATE_KEY_IMMUTABLE).
--      Writes need a user session (MATERIAL_REQUEST_MESSAGE_TEMPLATE_USER_ONLY): the service role writes none.
--    - RLS, forced: a member reads, adds, changes and deletes only their own row in their active tenant.
--    - It belongs to the membership (composite FK, ON DELETE CASCADE): a revoked membership, a deleted profile or
--      tenant takes it away, and a member who joins again starts from the company's or the built-in message.
--      Deleting the row is « Rétablir le modèle par défaut ».
-- 2. public.tenant_consultation_message_templates: the company's general template, one row per tenant.
--    - Read by the members of the active tenant: tenant_id and the two texts only (column grants); never its author.
--    - Written only through public.save_tenant_consultation_message_template (atomic upsert of both texts) and
--      public.reset_tenant_consultation_message_template (idempotent delete, « Rétablir le message d’origine »),
--      by an admin of the caller's ACTIVE tenant: a tenant_memberships row (active tenant, auth.uid(), admin).
--      public.has_tenant_role is not used here: it also admits the platform's global admins. The tenant is never
--      passed by the caller. The functions stamp updated_by and updated_at at each save.
--    - No change to the members' own templates when it changes: a personal template covers both texts as a pair.
-- Regression: supabase/tests/database/material-request-message-templates.test.sql.

begin;

do $preflight$
begin
  if to_regprocedure('public.current_tenant_id()') is null
    or to_regclass('public.tenants') is null
    or to_regclass('public.tenant_memberships') is null
    or to_regclass('public.profiles') is null
    or not exists (
      select 1 from pg_constraint constraint_
      where constraint_.conrelid = 'public.tenant_memberships'::regclass
        and constraint_.contype in ('u', 'p')
        and (
          select array_agg(attribute.attname::text order by attribute.attname)
          from pg_attribute attribute
          where attribute.attrelid = constraint_.conrelid and attribute.attnum = any(constraint_.conkey)
        ) = array['tenant_id', 'user_id']
    )
  then
    raise exception 'TI691_MESSAGE_TEMPLATES_PREREQUISITE_MISSING';
  end if;
  if to_regclass('public.material_request_message_templates') is not null
    or to_regclass('public.tenant_consultation_message_templates') is not null
  then
    raise exception 'TI691_MESSAGE_TEMPLATES_PREFLIGHT: a message template table already exists';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. A member's own template.
-- ---------------------------------------------------------------------------
create table public.material_request_message_templates (
  tenant_id uuid not null,
  user_id uuid not null,
  message_template text not null
    check (char_length(message_template) between 1 and 2000 and message_template ~ '[^[:space:]]'),
  line_template text not null
    check (char_length(line_template) between 1 and 300 and line_template ~ '[^[:space:]]'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_request_message_templates_pkey primary key (tenant_id, user_id),
  constraint material_request_message_templates_membership_fkey foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id) on delete cascade
);

comment on table public.material_request_message_templates is
  'TI-691: a member''s own template of the supplier consultation message, per membership. Keys set by trigger from auth.uid() and current_tenant_id(), then frozen; only the member reads or writes it. Absent row: the company''s template, else the built-in message.';
comment on column public.material_request_message_templates.message_template is
  'TI-691: the whole message, with {affaire}, {fournisseur}, {lignes}, {livraison} and optional parts in brackets (src/lib/material-requests/consultation-template.ts).';
comment on column public.material_request_message_templates.line_template is
  'TI-691: what is written for each line, with {quantité}, {désignation}, {référence}, {ligne}.';

create index material_request_message_templates_user_idx on public.material_request_message_templates (user_id);

-- The member and the tenant are the database's, never the client's. Runs as the caller.
create function private.enforce_material_request_message_template_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  actor_user_id uuid := (select auth.uid());
begin
  if actor_user_id is null then
    raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_MESSAGE_TEMPLATE_USER_ONLY';
  end if;
  if tg_op = 'INSERT' then
    new.user_id := actor_user_id;
    new.tenant_id := (select public.current_tenant_id());
    if new.tenant_id is null then
      raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_MESSAGE_TEMPLATE_NO_TENANT';
    end if;
    new.created_at := now();
  else
    if new.user_id is distinct from old.user_id or new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_MESSAGE_TEMPLATE_KEY_IMMUTABLE';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.enforce_material_request_message_template_write() from public, anon, authenticated;

create trigger enforce_material_request_message_template_write
  before insert or update on public.material_request_message_templates
  for each row execute function private.enforce_material_request_message_template_write();

alter table public.material_request_message_templates enable row level security;
alter table public.material_request_message_templates force row level security;

revoke all on public.material_request_message_templates from public, anon, authenticated;
grant select, insert, update, delete on public.material_request_message_templates to authenticated;
grant select, delete on public.material_request_message_templates to service_role;

create policy "Members read their own message template"
  on public.material_request_message_templates for select to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

create policy "Members add their own message template"
  on public.material_request_message_templates for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

create policy "Members change their own message template"
  on public.material_request_message_templates for update to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()))
  with check (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

create policy "Members delete their own message template"
  on public.material_request_message_templates for delete to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- 2. The company's general template.
-- ---------------------------------------------------------------------------
create table public.tenant_consultation_message_templates (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  message_template text not null
    check (char_length(message_template) between 1 and 2000 and message_template ~ '[^[:space:]]'),
  line_template text not null
    check (char_length(line_template) between 1 and 300 and line_template ~ '[^[:space:]]'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.tenant_consultation_message_templates is
  'TI-691: the company''s general template of the supplier consultation message, used by members without their own. Read by the members of the active tenant (tenant_id and the texts); written only by public.save_tenant_consultation_message_template and public.reset_tenant_consultation_message_template (admins of the active tenant).';
comment on column public.tenant_consultation_message_templates.updated_by is
  'TI-691: admin who last saved it. Never readable by members.';

create index tenant_consultation_message_templates_updated_by_idx
  on public.tenant_consultation_message_templates (updated_by);

alter table public.tenant_consultation_message_templates enable row level security;
alter table public.tenant_consultation_message_templates force row level security;

revoke all on public.tenant_consultation_message_templates from public, anon, authenticated;
grant select (tenant_id, message_template, line_template) on public.tenant_consultation_message_templates to authenticated;
grant select, insert, update, delete on public.tenant_consultation_message_templates to service_role;

create policy "Members read their active tenant's message template"
  on public.tenant_consultation_message_templates for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- The caller's active tenant when they are one of its admins (a membership row), else null.
create function private.consultation_template_admin_tenant()
returns uuid language sql stable security definer set search_path = '' as $$
  select membership.tenant_id
  from public.tenant_memberships membership
  where membership.tenant_id = (select public.current_tenant_id())
    and membership.user_id = (select auth.uid())
    and membership.role = 'admin'::public.tenant_role
$$;

revoke all on function private.consultation_template_admin_tenant() from public, anon, authenticated;

create function public.save_tenant_consultation_message_template(
  p_message_template text,
  p_line_template text
)
returns table (tenant_id uuid, message_template text, line_template text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_tenant_id uuid := private.consultation_template_admin_tenant();
begin
  if admin_tenant_id is null then
    raise exception using errcode = '42501', message = 'TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY';
  end if;

  return query
  insert into public.tenant_consultation_message_templates as company (
    tenant_id, message_template, line_template, updated_by, updated_at
  ) values (
    admin_tenant_id, p_message_template, p_line_template, (select auth.uid()), now()
  )
  on conflict on constraint tenant_consultation_message_templates_pkey do update
    set message_template = excluded.message_template,
        line_template = excluded.line_template,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
  returning company.tenant_id, company.message_template, company.line_template;
end;
$$;

comment on function public.save_tenant_consultation_message_template(text, text) is
  'TI-691: an admin of the caller''s active tenant saves its general consultation message template (both texts at once). TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY otherwise; bounds by the table''s checks (23514), missing text 23502.';

create function public.reset_tenant_consultation_message_template()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_tenant_id uuid := private.consultation_template_admin_tenant();
begin
  if admin_tenant_id is null then
    raise exception using errcode = '42501', message = 'TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY';
  end if;
  delete from public.tenant_consultation_message_templates company where company.tenant_id = admin_tenant_id;
  return found;
end;
$$;

comment on function public.reset_tenant_consultation_message_template() is
  'TI-691: an admin of the caller''s active tenant removes its general template (« Rétablir le message d’origine »); repeating it is harmless. Answers whether a template was removed.';

revoke all on function public.save_tenant_consultation_message_template(text, text) from public, anon;
revoke all on function public.reset_tenant_consultation_message_template() from public, anon;
grant execute on function public.save_tenant_consultation_message_template(text, text) to authenticated, service_role;
grant execute on function public.reset_tenant_consultation_message_template() to authenticated, service_role;

commit;

-- Configurable estimate PDF layout metadata and reviewed tenant CGV snapshots.

create table if not exists public.estimate_terms_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null default 'Conditions generales de vente',
  body text not null,
  version integer not null default 1 check (version >= 1),
  policy text not null default 'optional'
    check (policy in ('optional', 'default', 'required')),
  is_active boolean not null default true,
  legal_reviewed_at timestamptz not null,
  legal_reviewed_by uuid references public.profiles(id) on delete set null,
  constraint estimate_terms_templates_title_not_blank
    check (length(btrim(title)) > 0),
  constraint estimate_terms_templates_body_not_blank
    check (length(btrim(body)) > 0),
  unique (tenant_id)
);

create index if not exists estimate_terms_templates_tenant_active_idx
  on public.estimate_terms_templates (tenant_id, is_active);

drop trigger if exists set_estimate_terms_templates_updated_at
  on public.estimate_terms_templates;
create trigger set_estimate_terms_templates_updated_at
  before update on public.estimate_terms_templates
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_terms_templates_tenant_id
  on public.estimate_terms_templates;
create trigger set_estimate_terms_templates_tenant_id
  before insert or update on public.estimate_terms_templates
  for each row execute procedure public.assign_tenant_id();

alter table public.estimate_terms_templates enable row level security;
alter table public.estimate_terms_templates force row level security;

drop policy if exists "Current tenant members can view estimate terms templates"
  on public.estimate_terms_templates;
drop policy if exists "Current tenant admins can manage estimate terms templates"
  on public.estimate_terms_templates;

create policy "Current tenant members can view estimate terms templates"
  on public.estimate_terms_templates
  for select
  to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy "Current tenant admins can manage estimate terms templates"
  on public.estimate_terms_templates
  for all
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  );

alter table public.estimate_documents
  add column if not exists layout_options jsonb not null default '{}'::jsonb,
  add column if not exists terms_snapshot jsonb;

alter table public.estimate_documents
  drop constraint if exists estimate_documents_layout_options_object_check;
alter table public.estimate_documents
  add constraint estimate_documents_layout_options_object_check
  check (jsonb_typeof(layout_options) = 'object');

alter table public.estimate_documents
  drop constraint if exists estimate_documents_terms_snapshot_object_check;
alter table public.estimate_documents
  add constraint estimate_documents_terms_snapshot_object_check
  check (terms_snapshot is null or jsonb_typeof(terms_snapshot) = 'object');

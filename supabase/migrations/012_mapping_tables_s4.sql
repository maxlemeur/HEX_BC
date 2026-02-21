-- Migration S4 (BC-008): add mapping tables, memory, templates, and RLS.

create table if not exists public.mapping_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  supplier_name text,
  mapping jsonb not null,
  is_default boolean not null default false,
  last_used_at timestamptz,
  unique (user_id, name)
);

drop trigger if exists set_mapping_templates_updated_at on public.mapping_templates;
create trigger set_mapping_templates_updated_at
  before update on public.mapping_templates
  for each row execute procedure public.set_updated_at();

create index if not exists mapping_templates_user_updated_at_idx
  on public.mapping_templates (user_id, updated_at desc);
create index if not exists mapping_templates_supplier_name_idx
  on public.mapping_templates (supplier_name);

create table if not exists public.mapping_memory (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_column text not null,
  target_field text not null,
  usage_count integer not null default 1 check (usage_count >= 1),
  confidence numeric(5,4) not null default 1.0000 check (confidence >= 0 and confidence <= 1),
  last_used_at timestamptz not null default now(),
  unique (user_id, source_column, target_field)
);

drop trigger if exists set_mapping_memory_updated_at on public.mapping_memory;
create trigger set_mapping_memory_updated_at
  before update on public.mapping_memory
  for each row execute procedure public.set_updated_at();

create index if not exists mapping_memory_user_source_idx
  on public.mapping_memory (user_id, source_column);
create index if not exists mapping_memory_user_target_idx
  on public.mapping_memory (user_id, target_field);

create table if not exists public.dpgf_mappings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  import_id uuid not null references public.dpgf_imports(id) on delete cascade,
  template_id uuid references public.mapping_templates(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'validated', 'applied', 'archived')),
  column_mapping jsonb not null,
  required_fields_present boolean not null default false,
  missing_required_fields text[] not null default '{}',
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  notes text
);

drop trigger if exists set_dpgf_mappings_updated_at on public.dpgf_mappings;
create trigger set_dpgf_mappings_updated_at
  before update on public.dpgf_mappings
  for each row execute procedure public.set_updated_at();

create index if not exists dpgf_mappings_import_id_created_at_idx
  on public.dpgf_mappings (import_id, created_at desc);
create index if not exists dpgf_mappings_status_idx
  on public.dpgf_mappings (status);
create index if not exists dpgf_mappings_template_id_idx
  on public.dpgf_mappings (template_id);

alter table public.mapping_templates enable row level security;
alter table public.mapping_memory enable row level security;
alter table public.dpgf_mappings enable row level security;

drop policy if exists "Users can manage own mapping templates" on public.mapping_templates;
drop policy if exists "Users can manage own mapping memory" on public.mapping_memory;
drop policy if exists "Users can manage own dpgf mappings" on public.dpgf_mappings;

create policy "Users can manage own mapping templates"
  on public.mapping_templates
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage own mapping memory"
  on public.mapping_memory
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage own dpgf mappings"
  on public.dpgf_mappings
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_mappings.import_id
        and di.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_mappings.import_id
        and di.user_id = (select auth.uid())
    )
  );

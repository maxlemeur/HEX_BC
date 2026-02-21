-- Migration S3 (BC-007): add DPGF import tables, RLS, and storage policies.

create table if not exists public.dpgf_imports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  filename text not null,
  source_format text not null check (source_format in ('json', 'csv', 'xlsx')),
  status text not null default 'pending' check (status in ('pending', 'parsing', 'completed', 'failed')),
  row_count integer not null default 0 check (row_count >= 0),
  error_message text,
  parse_mode text not null check (parse_mode in ('worker', 'server')),
  storage_path text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0)
);

drop trigger if exists set_dpgf_imports_updated_at on public.dpgf_imports;
create trigger set_dpgf_imports_updated_at
  before update on public.dpgf_imports
  for each row execute procedure public.set_updated_at();

create index if not exists dpgf_imports_user_created_at_idx
  on public.dpgf_imports (user_id, created_at desc);
create index if not exists dpgf_imports_status_idx
  on public.dpgf_imports (status);

create table if not exists public.dpgf_rows_raw (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.dpgf_imports(id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (import_id, row_index)
);

create index if not exists dpgf_rows_raw_import_id_idx
  on public.dpgf_rows_raw (import_id);
create index if not exists dpgf_rows_raw_import_id_row_index_idx
  on public.dpgf_rows_raw (import_id, row_index);

create table if not exists public.dpgf_rows_mapped (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.dpgf_imports(id) on delete cascade,
  raw_row_id uuid references public.dpgf_rows_raw(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'mapped', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists dpgf_rows_mapped_import_id_idx
  on public.dpgf_rows_mapped (import_id);
create index if not exists dpgf_rows_mapped_raw_row_id_idx
  on public.dpgf_rows_mapped (raw_row_id);
create index if not exists dpgf_rows_mapped_status_idx
  on public.dpgf_rows_mapped (status);

alter table public.dpgf_imports enable row level security;
alter table public.dpgf_rows_raw enable row level security;
alter table public.dpgf_rows_mapped enable row level security;

drop policy if exists "Users can manage own dpgf imports" on public.dpgf_imports;
drop policy if exists "Users can manage own dpgf raw rows" on public.dpgf_rows_raw;
drop policy if exists "Users can manage own dpgf mapped rows" on public.dpgf_rows_mapped;

create policy "Users can manage own dpgf imports"
  on public.dpgf_imports
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage own dpgf raw rows"
  on public.dpgf_rows_raw
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.user_id = (select auth.uid())
    )
  );

create policy "Users can manage own dpgf mapped rows"
  on public.dpgf_rows_mapped
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_mapped.import_id
        and di.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_mapped.import_id
        and di.user_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dpgf-imports',
  'dpgf-imports',
  false,
  52428800,
  array[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Users can upload own dpgf imports" on storage.objects;
drop policy if exists "Users can view own dpgf imports" on storage.objects;
drop policy if exists "Users can update own dpgf imports" on storage.objects;
drop policy if exists "Users can delete own dpgf imports" on storage.objects;

create policy "Users can upload own dpgf imports"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can view own dpgf imports"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can update own dpgf imports"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can delete own dpgf imports"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

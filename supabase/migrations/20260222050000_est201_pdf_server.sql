-- EST-201: server-side estimate PDF generation metadata and storage policies.

create table if not exists public.estimate_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  file_path text,
  sha256_hash text,
  file_size_bytes bigint,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz,
  status text not null check (status in ('processing', 'ready', 'failed')),
  last_error text,
  unique (tenant_id, version_id)
);

create index if not exists estimate_documents_tenant_status_idx
  on public.estimate_documents (tenant_id, status);

create index if not exists estimate_documents_version_id_idx
  on public.estimate_documents (version_id);

create index if not exists estimate_documents_sha256_hash_idx
  on public.estimate_documents (sha256_hash);

drop trigger if exists set_estimate_documents_updated_at on public.estimate_documents;
create trigger set_estimate_documents_updated_at
  before update on public.estimate_documents
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_documents_tenant_id on public.estimate_documents;
create trigger set_estimate_documents_tenant_id
  before insert or update on public.estimate_documents
  for each row execute procedure public.assign_tenant_id();

alter table public.estimate_documents enable row level security;

drop policy if exists "Users can view estimate documents" on public.estimate_documents;
drop policy if exists "Users can insert estimate documents" on public.estimate_documents;
drop policy if exists "Users can update estimate documents" on public.estimate_documents;
drop policy if exists "Admins can delete estimate documents" on public.estimate_documents;

create policy "Users can view estimate documents"
  on public.estimate_documents
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Users can insert estimate documents"
  on public.estimate_documents
  for insert
  to authenticated
  with check ((select public.is_tenant_member(tenant_id)));

create policy "Users can update estimate documents"
  on public.estimate_documents
  for update
  to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check ((select public.is_tenant_member(tenant_id)));

create policy "Admins can delete estimate documents"
  on public.estimate_documents
  for delete
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'estimate-documents',
  'estimate-documents',
  false,
  20971520,
  array['application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "Tenant users can view estimate documents storage" on storage.objects;
drop policy if exists "Tenant users can insert estimate documents storage" on storage.objects;
drop policy if exists "Tenant users can update estimate documents storage" on storage.objects;
drop policy if exists "Tenant admins can delete estimate documents storage" on storage.objects;

create policy "Tenant users can view estimate documents storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'estimate-documents'
    and coalesce((storage.foldername(name))[1], '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  );

create policy "Tenant users can insert estimate documents storage"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'estimate-documents'
    and coalesce((storage.foldername(name))[1], '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  );

create policy "Tenant users can update estimate documents storage"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'estimate-documents'
    and coalesce((storage.foldername(name))[1], '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  )
  with check (
    bucket_id = 'estimate-documents'
    and coalesce((storage.foldername(name))[1], '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  );

create policy "Tenant admins can delete estimate documents storage"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'estimate-documents'
    and coalesce((storage.foldername(name))[1], '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (
      select public.has_tenant_role(
        ((storage.foldername(name))[1])::uuid,
        array['admin'::public.tenant_role]
      )
    )
  );

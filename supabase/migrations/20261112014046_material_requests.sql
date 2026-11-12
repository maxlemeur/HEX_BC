-- TI-690 (delivery 2, « la demande »): what a field technician asks the office for, rewritten by one
-- operator into clean lines, with the original (photo or pasted text) kept beside them. There is no
-- stock: a request always ends in a purchase, which a later delivery adds.
--
-- Four new tables and one private bucket; no existing table or row is touched. Written by signed-in
-- members through the Data API under RLS, never by the service role:
--   read  = whoever reads the affaire (owner, admin, director);
--   write = owner or admin of the affaire, with the tenant role admin or engineer.
-- Technicians have no account: a plain list of names per tenant, deactivated rather than deleted.

create table public.material_request_technicians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  -- The site the technician is on at the moment; prefills the affaire of a new request.
  current_project_id uuid references public.estimate_projects(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One name per tenant, whatever its case and spacing: a name retyped in capitals or without its space
-- is the same technician.
create unique index material_request_technicians_tenant_name_key
  on public.material_request_technicians (tenant_id, lower(regexp_replace(name, '\s+', '', 'g')));
create index material_request_technicians_current_project_idx
  on public.material_request_technicians (current_project_id);
create index material_request_technicians_created_by_idx on public.material_request_technicians (created_by);

create table public.material_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  -- A request belongs to an affaire and goes with it.
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  technician_id uuid references public.material_request_technicians(id) on delete set null,
  requested_on date not null default (timezone('Europe/Paris', now()))::date,
  needed_on date,
  delivery_place text check (delivery_place in ('site', 'office', 'counter')),
  is_urgent boolean not null default false,
  -- Presumed for every line that names no material: a proposal until an operator confirms it.
  presumed_material text check (presumed_material is null
    or (presumed_material = btrim(presumed_material) and char_length(presumed_material) between 1 and 120)),
  material_confirmed boolean not null default false,
  material_confirmed_at timestamptz,
  material_confirmed_by uuid references public.profiles(id) on delete set null,
  -- A supplier or brand written at the top of the sheet: a strong hint, to be confirmed.
  presumed_supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_confirmed boolean not null default false,
  supplier_confirmed_at timestamptz,
  supplier_confirmed_by uuid references public.profiles(id) on delete set null,
  -- The pasted message, kept verbatim beside the lines.
  source_text text check (source_text is null or char_length(source_text) between 1 and 20000),
  note text check (note is null or char_length(note) between 1 and 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A confirmation is about a value, and its author and date are the trigger's.
  constraint material_requests_material_confirmation_check check (
    (material_confirmed and presumed_material is not null and material_confirmed_at is not null)
    or (not material_confirmed and material_confirmed_at is null and material_confirmed_by is null)
  ),
  constraint material_requests_supplier_confirmation_check check (
    (supplier_confirmed and presumed_supplier_id is not null and supplier_confirmed_at is not null)
    or (not supplier_confirmed and supplier_confirmed_at is null and supplier_confirmed_by is null)
  )
);
create index material_requests_project_created_at_idx on public.material_requests (project_id, created_at desc);
create index material_requests_tenant_created_at_idx on public.material_requests (tenant_id, created_at desc);
create index material_requests_technician_created_at_idx on public.material_requests (technician_id, created_at desc);
create index material_requests_presumed_supplier_idx on public.material_requests (presumed_supplier_id);
create index material_requests_created_by_idx on public.material_requests (created_by);
create index material_requests_material_confirmed_by_idx on public.material_requests (material_confirmed_by);
create index material_requests_supplier_confirmed_by_idx on public.material_requests (supplier_confirmed_by);

create table public.material_request_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  request_id uuid not null references public.material_requests(id) on delete cascade,
  -- <tenant>/<project>/<request>/<file>/<sanitized name> in the bucket « material-requests ».
  storage_path text not null unique,
  file_name text not null check (length(btrim(file_name)) > 0 and char_length(file_name) <= 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 20971520),
  -- Display rotation chosen by the operator; the stored bytes are never rewritten.
  rotation smallint not null default 0 check (rotation in (0, 90, 180, 270)),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Null until the bytes are in storage. The row comes first (the storage policy needs it), so a row
  -- alone proves nothing: the application lists, counts and serves stored originals only.
  stored_at timestamptz,
  -- Set when the deletion of the original begins (or its upload is cancelled), before its bytes go:
  -- from then on the row is withdrawn from every reader and no upload can land at its path.
  removed_at timestamptz
);
create index material_request_files_request_created_at_idx on public.material_request_files (request_id, created_at);
create index material_request_files_tenant_idx on public.material_request_files (tenant_id);
create index material_request_files_project_idx on public.material_request_files (project_id);
create index material_request_files_created_by_idx on public.material_request_files (created_by);

create table public.material_request_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  request_id uuid not null references public.material_requests(id) on delete cascade,
  position integer not null check (position > 0),
  -- The technician's own words for this line, kept beside the rewritten columns.
  original_text text check (original_text is null or char_length(original_text) between 1 and 500),
  quantity numeric(12,3) check (quantity is null or quantity > 0),
  -- The figure was overwritten or is hard to read on the original: a human must confirm it.
  quantity_doubtful boolean not null default false,
  unit text check (unit is null or char_length(unit) between 1 and 20),
  -- DN for piping, the useful size otherwise (M10, Ø 125, 110 x 60 mm).
  dimension text check (dimension is null or char_length(dimension) between 1 and 80),
  -- The article has no meaningful size.
  no_dimension boolean not null default false,
  product_type text check (product_type is null or char_length(product_type) between 1 and 200),
  material text check (material is null or char_length(material) between 1 and 120),
  material_precision text check (material_precision is null or char_length(material_precision) between 1 and 120),
  reference text check (reference is null or char_length(reference) between 1 and 120),
  supplier_id uuid references public.suppliers(id) on delete set null,
  zone text check (zone is null or char_length(zone) between 1 and 80),
  imputation text not null default 'project' check (imputation in ('project', 'overhead')),
  overhead_category text check (overhead_category is null or char_length(overhead_category) between 1 and 80),
  -- The operator has looked at the possible duplicate and keeps this line.
  duplicate_acknowledged boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'validated')),
  validated_at timestamptz,
  validated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- What one row can prove. The material rule spans the request and is enforced by the line trigger
  -- below (a line is validated in a material: its own, or the request's once confirmed). The duplicate
  -- rule is NOT enforced by the database: only the application checks it
  -- (src/lib/material-requests/alerts.ts) before it validates a line.
  constraint material_request_lines_validated_complete_check check (
    status <> 'validated'
    or (
      quantity is not null
      and not quantity_doubtful
      and btrim(coalesce(unit, '')) <> ''
      and btrim(coalesce(product_type, '')) <> ''
      and (no_dimension or btrim(coalesce(dimension, '')) <> '')
    )
  ),
  constraint material_request_lines_validation_stamp_check check (
    (status = 'validated' and validated_at is not null)
    or (status = 'draft' and validated_at is null and validated_by is null)
  )
);
-- One position per line of a request: the order of a request is never ambiguous. Deleting a line leaves a gap.
create unique index material_request_lines_request_position_key on public.material_request_lines (request_id, position);
create index material_request_lines_tenant_idx on public.material_request_lines (tenant_id);
create index material_request_lines_project_idx on public.material_request_lines (project_id);
create index material_request_lines_supplier_idx on public.material_request_lines (supplier_id);
create index material_request_lines_validated_by_idx on public.material_request_lines (validated_by);

-- Scope and stamps. The triggers run as the caller: a parent the caller cannot read is a parent that
-- does not exist. Tenant and affaire are copied from the parent, never taken from the client, and a
-- technician, supplier or site of another tenant is refused. An author column is written once: a
-- direct statement (trigger depth 1) cannot change it, only the deletion of that profile erases it.
create function private.enforce_material_request_technician_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_SCOPE_IMMUTABLE';
    end if;
    if new.created_by is not null or pg_trigger_depth() = 1 then new.created_by := old.created_by; end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  -- Checked when the site is set or changed, not on every update: the check runs as the caller, and
  -- whoever renames or deactivates a technician need not be able to read the affaire they are on.
  if new.current_project_id is not null
    and (tg_op = 'INSERT' or new.current_project_id is distinct from old.current_project_id)
    and not exists (
    select 1 from public.estimate_projects project
    where project.id = new.current_project_id and project.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create function private.enforce_material_request_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  project_tenant_id uuid;
begin
  if tg_op = 'INSERT' then
    select project.tenant_id into project_tenant_id
    from public.estimate_projects project where project.id = new.project_id;
    if project_tenant_id is null then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_PROJECT_NOT_FOUND';
    end if;
    new.tenant_id := project_tenant_id;
    new.created_at := now();
  else
    if new.tenant_id is distinct from old.tenant_id or new.project_id is distinct from old.project_id then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_SCOPE_IMMUTABLE';
    end if;
    if new.created_by is not null or pg_trigger_depth() = 1 then new.created_by := old.created_by; end if;
    new.created_at := old.created_at;
  end if;

  if new.technician_id is not null and not exists (
    select 1 from public.material_request_technicians technician
    where technician.id = new.technician_id and technician.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;
  if new.presumed_supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = new.presumed_supplier_id and supplier.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;

  -- A confirmation never outlives the value it was given for: clearing or changing the presumed
  -- material or supplier withdraws it, even when the same statement claims it.
  if new.presumed_material is null
    or (tg_op = 'UPDATE' and new.presumed_material is distinct from old.presumed_material) then
    new.material_confirmed := false;
  end if;
  if new.presumed_supplier_id is null
    or (tg_op = 'UPDATE' and new.presumed_supplier_id is distinct from old.presumed_supplier_id) then
    new.supplier_confirmed := false;
  end if;

  -- Author and date of a confirmation are stamped here, never taken from the client.
  if not new.material_confirmed then
    new.material_confirmed_at := null;
    new.material_confirmed_by := null;
  elsif tg_op = 'UPDATE' and old.material_confirmed then
    new.material_confirmed_at := old.material_confirmed_at;
    if new.material_confirmed_by is not null or pg_trigger_depth() = 1 then
      new.material_confirmed_by := old.material_confirmed_by;
    end if;
  else
    new.material_confirmed_at := clock_timestamp();
    new.material_confirmed_by := (select auth.uid());
  end if;
  if not new.supplier_confirmed then
    new.supplier_confirmed_at := null;
    new.supplier_confirmed_by := null;
  elsif tg_op = 'UPDATE' and old.supplier_confirmed then
    new.supplier_confirmed_at := old.supplier_confirmed_at;
    if new.supplier_confirmed_by is not null or pg_trigger_depth() = 1 then
      new.supplier_confirmed_by := old.supplier_confirmed_by;
    end if;
  else
    new.supplier_confirmed_at := clock_timestamp();
    new.supplier_confirmed_by := (select auth.uid());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create function private.enforce_material_request_file_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent record;
  path_prefix text;
begin
  if tg_op = 'UPDATE' then
    -- The display rotation changes; the stored mark and the withdrawal are each set once.
    if (new.id, new.tenant_id, new.project_id, new.request_id, new.storage_path, new.file_name, new.mime_type,
        new.byte_size, new.created_at)
      is distinct from (old.id, old.tenant_id, old.project_id, old.request_id, old.storage_path, old.file_name,
        old.mime_type, old.byte_size, old.created_at) then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_IMMUTABLE';
    end if;
    if new.created_by is not null or pg_trigger_depth() = 1 then new.created_by := old.created_by; end if;
    -- Withdrawn once, at the time the database sees it, and for good.
    if old.removed_at is not null then
      new.removed_at := old.removed_at;
    elsif new.removed_at is not null then
      new.removed_at := clock_timestamp();
    end if;
    -- An original turns only while it is listed: stored, and not withdrawn.
    if new.rotation is distinct from old.rotation and (old.stored_at is null or new.removed_at is not null) then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_NOT_STORED';
    end if;
    if old.stored_at is not null then
      new.stored_at := old.stored_at;
    elsif new.stored_at is not null then
      if new.removed_at is not null then
        raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_NOT_STORED';
      end if;
      -- Twelve listed originals per request (MATERIAL_REQUEST_MAX_FILES in the application). Marks on one
      -- request wait for each other on its row, so two uploads completed side by side cannot both pass.
      perform 1 from public.material_requests request where request.id = new.request_id for update;
      if (select count(*) from public.material_request_files other
          where other.request_id = new.request_id and other.id <> new.id
            and other.stored_at is not null and other.removed_at is null) >= 12 then
        raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_LIMIT';
      end if;
      -- Stored once, at the time the database sees it, and only when storage holds at its path an
      -- object of the announced size. The caller's own read of storage.objects is the proof: whoever
      -- may write here may read them. What this does NOT catch: bytes of the same size swapped between
      -- the application's check of their content and this mark. The guard on storage.objects below
      -- narrows that to an object deleted and uploaded again while the row is still unstored.
      if not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'material-requests' and object.name = new.storage_path
      ) then
        raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_NOT_STORED';
      end if;
      if not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'material-requests' and object.name = new.storage_path
          and pg_catalog.jsonb_typeof(object.metadata -> 'size') = 'number'
          and (object.metadata ->> 'size')::numeric = new.byte_size
      ) then
        raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_SIZE_MISMATCH';
      end if;
      new.stored_at := clock_timestamp();
    end if;
    return new;
  end if;
  -- The row is recorded before its bytes: it cannot claim to be stored, nor arrive withdrawn.
  if new.stored_at is not null or new.removed_at is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_NOT_STORED';
  end if;
  select request.tenant_id, request.project_id into parent
  from public.material_requests request where request.id = new.request_id;
  if parent.tenant_id is null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_NOT_FOUND';
  end if;
  new.tenant_id := parent.tenant_id;
  new.project_id := parent.project_id;
  new.created_at := now();
  -- Rows waiting for their bytes are bounded per request, so that preparing uploads cannot pile up
  -- rows and signed tokens: two full batches in flight, no more.
  if (select count(*) from public.material_request_files other
      where other.request_id = new.request_id and other.stored_at is null and other.removed_at is null) >= 24 then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_UPLOADS_PENDING';
  end if;
  -- The storage policies trust this path: it names the row it belongs to, then one file name.
  path_prefix := new.tenant_id::text || '/' || new.project_id::text || '/' || new.request_id::text
    || '/' || new.id::text || '/';
  if left(new.storage_path, char_length(path_prefix)) is distinct from path_prefix
    or char_length(new.storage_path) = char_length(path_prefix)
    or position('/' in substr(new.storage_path, char_length(path_prefix) + 1)) > 0 then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_PATH_INVALID';
  end if;
  return new;
end;
$$;

create function private.enforce_material_request_line_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent record;
  presumed record;
begin
  if tg_op = 'INSERT' then
    select request.tenant_id, request.project_id into parent
    from public.material_requests request where request.id = new.request_id;
    if parent.tenant_id is null then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_NOT_FOUND';
    end if;
    new.tenant_id := parent.tenant_id;
    new.project_id := parent.project_id;
    new.created_at := now();
  elsif new.tenant_id is distinct from old.tenant_id or new.project_id is distinct from old.project_id
    or new.request_id is distinct from old.request_id then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_SCOPE_IMMUTABLE';
  else
    new.created_at := old.created_at;
  end if;

  if new.supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = new.supplier_id and supplier.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;

  -- A validated line always describes what was validated: changing what it says returns it to draft,
  -- even when the same statement keeps it validated. Position and the duplicate acknowledgement are
  -- not what it says, and a supplier erased by its own deletion (trigger depth 2) is not an edit.
  if tg_op = 'UPDATE' and old.status = 'validated' and new.status = 'validated' and pg_trigger_depth() = 1 and (
    (new.original_text, new.quantity, new.quantity_doubtful, new.unit, new.dimension, new.no_dimension,
      new.product_type, new.material, new.material_precision, new.reference, new.supplier_id, new.zone,
      new.imputation, new.overhead_category)
    is distinct from
    (old.original_text, old.quantity, old.quantity_doubtful, old.unit, old.dimension, old.no_dimension,
      old.product_type, old.material, old.material_precision, old.reference, old.supplier_id, old.zone,
      old.imputation, old.overhead_category)
  ) then
    new.status := 'draft';
  end if;

  -- A line is validated in a material: its own, or the one presumed for its request once an operator
  -- has confirmed it. Overhead (PPE, small tooling) is not ordered in the request's material. The
  -- request row is locked against a concurrent change of that material until this validation commits;
  -- the request's own trigger returns to draft the lines that relied on a material it withdraws.
  if new.status = 'validated' and (tg_op = 'INSERT' or old.status <> 'validated')
    and new.imputation = 'project' and btrim(coalesce(new.material, '')) = '' then
    select request.presumed_material, request.material_confirmed into presumed
    from public.material_requests request where request.id = new.request_id for share;
    if btrim(coalesce(presumed.presumed_material, '')) = '' then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_MATERIAL_MISSING';
    elsif not presumed.material_confirmed then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_MATERIAL_UNCONFIRMED';
    end if;
  end if;

  -- Author and date of a validation are stamped here, never taken from the client.
  if new.status <> 'validated' then
    new.validated_at := null;
    new.validated_by := null;
  elsif tg_op = 'UPDATE' and old.status = 'validated' then
    new.validated_at := old.validated_at;
    if new.validated_by is not null or pg_trigger_depth() = 1 then new.validated_by := old.validated_by; end if;
  else
    new.validated_at := clock_timestamp();
    new.validated_by := (select auth.uid());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- When the material presumed for a request changes, is cleared or loses its confirmation, the validated
-- lines that relied on it (no material of their own, not overhead) return to draft in the same
-- statement: nobody validated them in the material that comes next.
create function private.reopen_material_request_lines_without_material()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.material_request_lines line
  set status = 'draft'
  where line.request_id = new.id
    and line.status = 'validated'
    and line.imputation = 'project'
    and btrim(coalesce(line.material, '')) = '';
  return null;
end;
$$;

revoke all on function private.reopen_material_request_lines_without_material() from public, anon, authenticated;
revoke all on function private.enforce_material_request_technician_write() from public, anon, authenticated;
revoke all on function private.enforce_material_request_write() from public, anon, authenticated;
revoke all on function private.enforce_material_request_file_write() from public, anon, authenticated;
revoke all on function private.enforce_material_request_line_write() from public, anon, authenticated;

create trigger enforce_material_request_technician_write
  before insert or update on public.material_request_technicians
  for each row execute function private.enforce_material_request_technician_write();
create trigger enforce_material_request_write
  before insert or update on public.material_requests
  for each row execute function private.enforce_material_request_write();
create trigger reopen_material_request_lines_without_material
  after update on public.material_requests
  for each row
  when (new.presumed_material is distinct from old.presumed_material
    or (old.material_confirmed and not new.material_confirmed))
  execute function private.reopen_material_request_lines_without_material();
create trigger enforce_material_request_file_write
  before insert or update on public.material_request_files
  for each row execute function private.enforce_material_request_file_write();
create trigger enforce_material_request_line_write
  before insert or update on public.material_request_lines
  for each row execute function private.enforce_material_request_line_write();

alter table public.material_request_technicians enable row level security;
alter table public.material_request_technicians force row level security;
alter table public.material_requests enable row level security;
alter table public.material_requests force row level security;
alter table public.material_request_files enable row level security;
alter table public.material_request_files force row level security;
alter table public.material_request_lines enable row level security;
alter table public.material_request_lines force row level security;

revoke all on public.material_request_technicians, public.material_requests, public.material_request_files,
  public.material_request_lines from public, anon, authenticated;
-- Technicians are deactivated, never deleted: their past requests keep their name.
grant select, insert, update on public.material_request_technicians to authenticated;
grant select, insert, update, delete on public.material_requests, public.material_request_files,
  public.material_request_lines to authenticated;
grant select, insert, update, delete on public.material_request_technicians, public.material_requests,
  public.material_request_files, public.material_request_lines to service_role;

create policy "Tenant members read material request technicians"
  on public.material_request_technicians for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy "Operators add material request technicians"
  on public.material_request_technicians for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Operators change material request technicians"
  on public.material_request_technicians for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );

create policy "Affaire readers read material requests"
  on public.material_requests for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );
create policy "Affaire operators add material requests"
  on public.material_requests for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Affaire operators change material requests"
  on public.material_requests for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Affaire operators delete material requests"
  on public.material_requests for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );

create policy "Affaire readers read material request files"
  on public.material_request_files for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );
create policy "Affaire operators add material request files"
  on public.material_request_files for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Affaire operators change material request files"
  on public.material_request_files for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Affaire operators delete material request files"
  on public.material_request_files for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );

create policy "Affaire readers read material request lines"
  on public.material_request_lines for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );
create policy "Affaire operators add material request lines"
  on public.material_request_lines for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Affaire operators change material request lines"
  on public.material_request_lines for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Affaire operators delete material request lines"
  on public.material_request_lines for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );

-- The materials the tenant's catalogue already names: what the operator picks from, never a decision.
-- Runs as the caller, under the catalogue's own read policy, for the active tenant only.
create function public.material_request_material_options()
returns text[]
language sql stable security invoker set search_path = ''
as $$
  select coalesce(array_agg(distinct btrim(product.material) order by btrim(product.material)), '{}'::text[])
  from public.products product
  where product.tenant_id = (select public.current_tenant_id())
    and nullif(btrim(product.material), '') is not null;
$$;
revoke all on function public.material_request_material_options() from public, anon;
grant execute on function public.material_request_material_options() to authenticated, service_role;

-- Originals: photographs of paper and screenshots of messages, read back through the application only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('material-requests', 'material-requests', false, 20971520, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- What is guaranteed for this bucket, and by what:
--  * an object is created only at the path of a material_request_files row that is neither stored nor
--    withdrawn, whoever inserts it (guard trigger below). Uploads are signed: the INSERT policy is
--    evaluated for the caller when the URL is created, and the token then lives two hours without any
--    policy; the trigger is what binds it to a row that is still waiting for its bytes;
--  * the bytes of a stored original are not replaced: no UPDATE policy, no second object at its path,
--    no change to its object's metadata or path, by anyone;
--  * the object of a listed original (stored, not withdrawn) is not deleted directly: the row is
--    withdrawn first (removed_at), which hides it from every reader, then its object goes, then the row.
-- What is NOT guaranteed: an object does not disappear with its row. Deleting a request or an affaire
-- in SQL cascades the rows and leaves their bytes in the bucket, where only the service role reaches
-- them; and a same-size swap of bytes before a row is marked stored is not seen by the database.
create policy "Affaire readers view material request storage"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'material-requests'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 4
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1 from public.material_request_files f
      where f.storage_path = objects.name
        and f.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and f.project_id::text = coalesce((storage.foldername(objects.name))[2], '')
        and f.request_id::text = coalesce((storage.foldername(objects.name))[3], '')
        and f.id::text = coalesce((storage.foldername(objects.name))[4], '')
        and (select public.can_read_affaire_intake_project(f.project_id, f.tenant_id))
    )
  );
create policy "Affaire operators insert material request storage"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'material-requests'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 4
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
    and exists (
      select 1 from public.material_request_files f
      where f.storage_path = objects.name
        and f.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and f.project_id::text = coalesce((storage.foldername(objects.name))[2], '')
        and f.request_id::text = coalesce((storage.foldername(objects.name))[3], '')
        and f.id::text = coalesce((storage.foldername(objects.name))[4], '')
        and f.created_by = (select auth.uid())
        and f.stored_at is null
        and f.removed_at is null
        and (select public.can_access_affaire_intake_project(f.project_id, f.tenant_id))
    )
  );
-- No UPDATE policy: an original is uploaded once (never upserted), and an UPDATE policy would let any
-- writer replace stored bytes silently.
create policy "Affaire operators delete material request storage"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'material-requests'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 4
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
    and exists (
      select 1 from public.material_request_files f
      where f.storage_path = objects.name
        and f.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and f.project_id::text = coalesce((storage.foldername(objects.name))[2], '')
        and f.request_id::text = coalesce((storage.foldername(objects.name))[3], '')
        and f.id::text = coalesce((storage.foldername(objects.name))[4], '')
        and (select public.can_access_affaire_intake_project(f.project_id, f.tenant_id))
    )
  );

-- Binds every write on storage.objects for this bucket to the state of its row, whoever writes: the
-- policies above are not evaluated for an upload made with a signed token, nor for the service role.
-- Returns at once for every other bucket. The row is locked (FOR SHARE) so that an upload either lands
-- before its row is stored, withdrawn or deleted, or is refused after.
create function private.guard_material_request_storage_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  file_row public.material_request_files;
begin
  if tg_op = 'UPDATE' then
    if new.bucket_id <> 'material-requests' and old.bucket_id <> 'material-requests' then return new; end if;
    if new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_MOVE_FORBIDDEN';
    end if;
    -- A read may date the object; what the object holds changes only while its row waits for its bytes.
    if new.metadata is not distinct from old.metadata and new.version is not distinct from old.version then
      return new;
    end if;
  elsif new.bucket_id <> 'material-requests' then
    return new;
  end if;
  select * into file_row from public.material_request_files where storage_path = new.name for share;
  if not found then
    raise exception using errcode = '23503', message = 'MATERIAL_REQUEST_FILE_ROW_REQUIRED';
  end if;
  if file_row.removed_at is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_REMOVED';
  end if;
  if file_row.stored_at is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_ALREADY_STORED';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_material_request_storage_write() from public, anon, authenticated;
create trigger guard_material_request_storage_write before insert or update on storage.objects
  for each row execute function private.guard_material_request_storage_write();

-- The object of a listed original is not deleted directly, even by who may write: a listed original
-- always has its bytes. The application withdraws the row first; an object whose row is gone, unstored
-- or withdrawn is deleted as the DELETE policy allows.
create function private.guard_material_request_storage_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.bucket_id <> 'material-requests' then return old; end if;
  perform 1 from public.material_request_files
  where storage_path = old.name and stored_at is not null and removed_at is null for share;
  if found then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_DELETE_THROUGH_APPLICATION';
  end if;
  return old;
end;
$$;
revoke execute on function private.guard_material_request_storage_delete() from public, anon, authenticated;
create trigger guard_material_request_storage_delete before delete on storage.objects
  for each row execute function private.guard_material_request_storage_delete();

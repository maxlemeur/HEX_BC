-- TI-691, lot 2 « l'achat », delivery 2 (« consultation »). No remote application is authorized here.
--
-- The office consults suppliers for some lines of a material request with a short message it copies into WhatsApp
-- (MergeOne sends nothing): WITH references for the usual supplier, WITHOUT them and with full designations to put
-- suppliers in competition. The answer is attached to the quote and priced line by line; the office retains ONE
-- quote, which closes the others sharing a line with it. The price imputed later to a line is its retained quote's.
--
-- 1. public.material_request_quotes: one consultation of one supplier, in the request's tenant and affaire (copied
--    from the request by the trigger, never taken from the client), a supplier of that tenant (restricted: a supplier
--    who was consulted cannot be deleted). Status requested -> received -> retained, or closed from requested or
--    received; retained and closed are final and read-only. Supplier, variant, message, request and dates of the
--    consultation never change; requested_at, received_at, retained_at/retained_by and closed_at are stamped here.
--    One supplier has at most one quote still requested or received per request (partial unique index); a retained
--    or closed one does not keep it from being consulted again (lines added later can go to the same supplier).
-- 2. public.material_request_quote_lines: the lines a quote asks for, each a line of the quote's request, with its
--    price excluding tax in whole cents (null until priced) for price_per units (1, 10, 100 or 1 000: a screw at
--    0,034 € is 340 cents for 100). Tenant and affaire are the quote's (project_id is kept on the row so that its
--    policies read like those of the lines, without a subquery per row). Written only by
--    public.create_material_request_quote (transaction-local marker app.material_request_quote_creating = the quote
--    id); fixed once the quote is retained or closed. A line already priced by a retained quote is not consulted again.
-- 3. material_request_lines.unit_price_ht_cents, price_per and price_quote_id: the retained quote's price for price_per
--    units, null (price_per 1) or set together. The amount of a line is quantity x price / price_per, rounded half away
--    from zero to the cent: nothing computes it in this delivery (the purchase that follows will). Purchasing
--    information, not in the validated-line backstop: a validated line stays validated. How the line
--    trigger refuses every other write to them: they change only while public.retain_material_request_quote runs for
--    that very quote (transaction-local marker app.material_request_quote_retaining = the quote id, which only a
--    database function can set: the Data API runs no SET), a line is priced once (old.price_quote_id null) and never
--    inserted priced; the only other change is the clearing made by the quote's own deletion (ON DELETE SET NULL,
--    trigger depth > 1; only the service role or the request's cascade deletes a quote). A priced line keeps the
--    quote's supplier (MATERIAL_REQUEST_LINE_SUPPLIER_FROM_QUOTE), keeps what it orders at that price (its article and
--    match, type, dimension and no_dimension, material, precision, reference, unit and quantity:
--    MATERIAL_REQUEST_LINE_PRICED; a DN 50 priced does not become a DN 65 at the DN 50 price) and is not deleted alone
--    (MATERIAL_REQUEST_LINE_PRICED; its request still is). Its zone, imputation, the technician's words, the quantity
--    doubt and the duplicate acknowledgement stay editable. There is no way back in this delivery: no reopening of a
--    retained quote, no unpricing of a line (only the quote's deletion by the service role clears it).
--    private.enforce_material_request_line_write() is copied from 20261112152357_purchase_line_suppliers.sql; only the
--    price block (with the presumed material the retaining writes) and the freeze of a priced line are new.
-- 4. public.retain_material_request_quote(uuid), SECURITY INVOKER, one transaction: the quote received, every line
--    priced, validated (its blocking alerts settled: retaining freezes what it orders) and none already retained
--    (coded refusals, positions in DETAIL); a quote may still be asked and priced for drafts; it becomes retained, its lines take its
--    supplier, price and id, a project line without its own material takes the request's presumed material (which must
--    be confirmed: the quote was asked in it, and the freeze of a priced line then keeps it), and every other
--    requested or received quote of the request sharing a line is closed.
--    The same marker lets only this function set a quote retained. public.create_material_request_quote and
--    public.update_material_request_quote write a quote with its lines in one statement each (all or nothing), as
--    the caller.
-- 5. Quote files reuse material_request_files (signed upload, stored mark, withdrawal, storage guards unchanged):
--    quote_id names the quote (cascade); a quote's file may be a PDF or an image, an original stays an image (CHECK);
--    the bucket accepts application/pdf. Ten listed files per quote (MATERIAL_REQUEST_QUOTE_MAX_FILES), apart from
--    the twelve originals of the request; the 24 uploads waiting for their bytes stay bounded per request. The files
--    of a retained or closed quote are read-only (the quote row shared-locked against a retaining in progress): no new
--    file, no stored mark (an upload prepared while the quote was open and completed after its retaining), no
--    rotation, and a listed file is neither withdrawn nor deleted (a direct statement; cascades still delete it). An
--    unlisted leftover is withdrawn and deleted as usual. The request's own deletion withdraws them through
--    public.withdraw_material_request_files_for_deletion (marker app.material_request_deleting = the request id), the
--    one path, for the writers who may delete the request anyway. private.enforce_material_request_file_write() is
--    copied from 20261112014046_material_requests.sql; only the quote checks and the cap per quote are new.
-- Rights: read = whoever reads the affaire's material requests (can_read_affaire_intake_project); write = the owner
-- of the affaire or an admin, with the role admin or engineer (can_access_affaire_intake_project + has_tenant_role).
-- Quotes are never deleted by a client: they are closed.
-- Regression: supabase/tests/database/material-request-quotes.test.sql.

begin;

do $preflight$
begin
  if to_regclass('public.material_requests') is null
    or to_regclass('public.material_request_lines') is null
    or to_regclass('public.material_request_files') is null
    or to_regclass('public.suppliers') is null
    or to_regprocedure('private.enforce_material_request_line_write()') is null
    or to_regprocedure('private.enforce_material_request_file_write()') is null
    or to_regprocedure('public.can_read_affaire_intake_project(uuid, uuid)') is null
    or to_regprocedure('public.can_access_affaire_intake_project(uuid, uuid)') is null
    or to_regprocedure('public.has_tenant_role(uuid, public.tenant_role[])') is null
    or to_regprocedure('public.current_tenant_id()') is null
    or not exists (select 1 from storage.buckets where id = 'material-requests')
    or not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.material_request_files'::regclass and conname = 'material_request_files_mime_type_check'
    )
  then
    raise exception 'TI691_QUOTES_PREREQUISITE_MISSING';
  end if;
  if to_regclass('public.material_request_quotes') is not null
    or to_regclass('public.material_request_quote_lines') is not null
  then
    raise exception 'TI691_QUOTES_PREFLIGHT: the quote tables already exist';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Quotes.
-- ---------------------------------------------------------------------------
create table public.material_request_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  request_id uuid not null references public.material_requests(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status text not null default 'requested' check (status in ('requested', 'received', 'retained', 'closed')),
  -- The variant copied: with the references (usual supplier), or without them and with full designations.
  with_references boolean not null,
  -- The message as copied into WhatsApp: room for 300 lines at their field limits (861 characters at most each, see
  -- MATERIAL_REQUEST_QUOTE_MESSAGE_MAX in quote-contracts.ts) with the opening and closing lines.
  message text not null check (char_length(message) between 1 and 262144),
  requested_at timestamptz not null default now(),
  received_at timestamptz,
  -- The supplier's total excluding tax; informative, the cost is per line.
  amount_ht_cents integer check (amount_ht_cents is null or amount_ht_cents >= 0),
  notes text check (notes is null or char_length(notes) between 1 and 2000),
  retained_at timestamptz,
  retained_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- What one row can prove of its life; the transitions and the dates are the trigger's.
  constraint material_request_quotes_status_stamps_check check (
    (status = 'requested' and received_at is null and retained_at is null and retained_by is null and closed_at is null)
    or (status = 'received' and received_at is not null and retained_at is null and retained_by is null and closed_at is null)
    or (status = 'retained' and received_at is not null and retained_at is not null and closed_at is null)
    or (status = 'closed' and closed_at is not null and retained_at is null and retained_by is null)
  )
);
-- One consultation of a supplier in progress at a time per request: once retained or closed, the supplier may be
-- consulted again (for lines added later, for instance).
create unique index material_request_quotes_open_supplier_key
  on public.material_request_quotes (request_id, supplier_id) where status in ('requested', 'received');
create index material_request_quotes_request_created_at_idx on public.material_request_quotes (request_id, created_at desc);
create index material_request_quotes_tenant_idx on public.material_request_quotes (tenant_id);
create index material_request_quotes_project_idx on public.material_request_quotes (project_id);
create index material_request_quotes_supplier_idx on public.material_request_quotes (supplier_id);
create index material_request_quotes_created_by_idx on public.material_request_quotes (created_by);
create index material_request_quotes_retained_by_idx on public.material_request_quotes (retained_by);

comment on table public.material_request_quotes is
  'TI-691: a consultation of one supplier for lines of a material request (message copied into WhatsApp, answer attached). requested -> received -> retained, or closed; retained and closed are final and read-only. At most one quote requested or received per request and supplier.';

create table public.material_request_quote_lines (
  quote_id uuid not null references public.material_request_quotes(id) on delete cascade,
  line_id uuid not null references public.material_request_lines(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  unit_price_ht_cents integer check (unit_price_ht_cents is null or unit_price_ht_cents >= 0),
  -- How many units the price is for: a price below one cent a unit is given for 100 or 1 000.
  price_per integer not null default 1 check (price_per in (1, 10, 100, 1000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (quote_id, line_id)
);
create index material_request_quote_lines_line_idx on public.material_request_quote_lines (line_id);
create index material_request_quote_lines_tenant_idx on public.material_request_quote_lines (tenant_id);
create index material_request_quote_lines_project_idx on public.material_request_quote_lines (project_id);

comment on table public.material_request_quote_lines is
  'TI-691: the lines a quote asks for (lines of its request) and their price excluding tax in whole cents for price_per units (1, 10, 100 or 1000). Written by create_material_request_quote only; fixed once the quote is retained or closed.';

-- ---------------------------------------------------------------------------
-- 3. The retained price of a line.
-- ---------------------------------------------------------------------------
alter table public.material_request_lines
  add column unit_price_ht_cents integer check (unit_price_ht_cents is null or unit_price_ht_cents >= 0),
  add column price_per integer not null default 1 check (price_per in (1, 10, 100, 1000)),
  add column price_quote_id uuid references public.material_request_quotes(id) on delete set null,
  add constraint material_request_lines_price_quote_check check (
    (price_quote_id is null) = (unit_price_ht_cents is null) and (price_quote_id is not null or price_per = 1)
  );
create index material_request_lines_price_quote_idx on public.material_request_lines (price_quote_id);

comment on column public.material_request_lines.unit_price_ht_cents is
  'TI-691: price excluding tax, in whole cents for price_per units, of the quote retained for the line (price_quote_id). Written only by public.retain_material_request_quote; purchasing information, a validated line stays validated. The amount is quantity x price / price_per, rounded half away from zero to the cent.';
comment on column public.material_request_lines.price_per is
  'TI-691: how many units unit_price_ht_cents is for (1, 10, 100 or 1000), written with it by the retaining; 1 while the line is unpriced.';
comment on column public.material_request_lines.price_quote_id is
  'TI-691: the retained quote that priced the line; its supplier is then the line''s and no longer changes.';

-- ---------------------------------------------------------------------------
-- 5. Quote files.
-- ---------------------------------------------------------------------------
alter table public.material_request_files
  add column quote_id uuid references public.material_request_quotes(id) on delete cascade;
create index material_request_files_quote_idx on public.material_request_files (quote_id);
-- An original is a photograph or a screenshot; a quote's answer may also be a PDF.
alter table public.material_request_files
  drop constraint material_request_files_mime_type_check,
  add constraint material_request_files_mime_type_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
    or (quote_id is not null and mime_type = 'application/pdf')
  );

comment on column public.material_request_files.quote_id is
  'TI-691: null for an original of the request (an image); the quote this file answers otherwise (PDF or image), listed with the quote.';

-- The bucket checks the type an upload declares; the application checks the bytes against the row's type before the
-- file is marked stored, and the row's CHECK keeps PDF to quote files.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'material-requests';

-- ---------------------------------------------------------------------------
-- Triggers. They run as the caller: a parent the caller cannot read is a parent that does not exist.
-- ---------------------------------------------------------------------------
create function private.enforce_material_request_quote_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent record;
begin
  if tg_op = 'INSERT' then
    select request.tenant_id, request.project_id into parent
    from public.material_requests request where request.id = new.request_id;
    if parent.tenant_id is null then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_NOT_FOUND';
    end if;
    new.tenant_id := parent.tenant_id;
    new.project_id := parent.project_id;
    -- A quote starts as the consultation it records, dated by the database.
    if new.status is distinct from 'requested' then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_STATUS_INVALID';
    end if;
    new.requested_at := now();
    new.received_at := null;
    new.retained_at := null;
    new.retained_by := null;
    new.closed_at := null;
    new.created_at := now();
    if not exists (
      select 1 from public.suppliers supplier
      where supplier.id = new.supplier_id and supplier.tenant_id = new.tenant_id
    ) then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- What was asked, of whom and when never changes.
  if (new.id, new.tenant_id, new.project_id, new.request_id, new.supplier_id, new.with_references, new.message,
      new.requested_at, new.created_at)
    is distinct from (old.id, old.tenant_id, old.project_id, old.request_id, old.supplier_id, old.with_references,
      old.message, old.requested_at, old.created_at) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_IMMUTABLE';
  end if;
  -- An author is written once; only the deletion of their profile (ON DELETE SET NULL, depth > 1) erases it.
  if new.created_by is not null or pg_trigger_depth() = 1 then new.created_by := old.created_by; end if;

  -- A retained or closed quote is read-only: nothing it says changes any more.
  if old.status in ('retained', 'closed')
    and (new.status, new.received_at, new.amount_ht_cents, new.notes, new.retained_at, new.closed_at)
      is distinct from (old.status, old.received_at, old.amount_ht_cents, old.notes, old.retained_at, old.closed_at)
  then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_READ_ONLY';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('requested', 'received'), ('requested', 'closed'), ('received', 'closed'), ('received', 'retained')
    ) then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_STATUS_INVALID';
    end if;
    -- Retaining prices lines and closes competitors: only public.retain_material_request_quote does it, for this quote.
    if new.status = 'retained'
      and pg_catalog.current_setting('app.material_request_quote_retaining', true) is distinct from new.id::text
    then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_RETAIN_THROUGH_FUNCTION';
    end if;
  end if;

  -- Dates and author of the life of a quote are the database's, never the client's.
  new.received_at := case when old.status = 'requested' and new.status = 'received' then clock_timestamp()
    else old.received_at end;
  if old.status <> 'retained' and new.status = 'retained' then
    new.retained_at := clock_timestamp();
    new.retained_by := (select auth.uid());
  else
    new.retained_at := old.retained_at;
    if new.retained_by is not null or pg_trigger_depth() = 1 then new.retained_by := old.retained_by; end if;
  end if;
  new.closed_at := case when old.status <> 'closed' and new.status = 'closed' then clock_timestamp() else old.closed_at end;

  new.updated_at := now();
  return new;
end;
$$;

create function private.enforce_material_request_quote_line_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  quote record;
  line record;
begin
  if tg_op = 'UPDATE' and (new.quote_id, new.line_id, new.tenant_id, new.project_id, new.created_at)
    is distinct from (old.quote_id, old.line_id, old.tenant_id, old.project_id, old.created_at) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_IMMUTABLE';
  end if;
  -- The quote row is shared-locked, so that a retaining (which locks it for update) sees the prices as they stand,
  -- and no price lands on a quote retained or closed in the meantime.
  select q.tenant_id, q.project_id, q.request_id, q.status into quote
  from public.material_request_quotes q where q.id = new.quote_id for share;
  if quote.request_id is null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_NOT_FOUND';
  end if;
  if quote.status in ('retained', 'closed') then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_READ_ONLY';
  end if;
  if tg_op = 'INSERT' then
    -- The lines of a quote are those it was created with: only public.create_material_request_quote writes them, for
    -- the quote it is creating, so that no line is added to a consultation already copied and sent.
    if pg_catalog.current_setting('app.material_request_quote_creating', true) is distinct from new.quote_id::text then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_THROUGH_FUNCTION';
    end if;
    -- A line of the quote's request, not priced by a retained quote yet: the line is shared-locked against a
    -- retaining that would price it meanwhile.
    select l.request_id, l.price_quote_id into line
    from public.material_request_lines l where l.id = new.line_id for share;
    if line.request_id is distinct from quote.request_id then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_REQUEST';
    end if;
    if line.price_quote_id is not null then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED';
    end if;
    new.tenant_id := quote.tenant_id;
    new.project_id := quote.project_id;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.enforce_material_request_line_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent record;
  presumed record;
  -- The retaining writes the request's presumed material on a project line that had none (see below).
  materialized boolean := false;
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
    -- Three hundred lines per request (MATERIAL_REQUEST_MAX_LINES in the application, which refuses
    -- first and in friendlier words). Appends to one request wait for each other on its row, so two of
    -- them cannot both count 299 and pass; a batch that would cross the cap fails as a whole. The
    -- request row is the first lock an append takes, and an append holds no line another transaction
    -- waits for, so it cannot close a lock cycle with a validation or a change to the request.
    perform 1 from public.material_requests request where request.id = new.request_id for update;
    if (select count(*) from public.material_request_lines other where other.request_id = new.request_id) >= 300 then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_LIMIT';
    end if;
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

  -- The article is one of the line's tenant. The trigger runs as the caller: an article the caller cannot
  -- read is one that does not exist. Checked when it is set; the tenant of a line never changes.
  if new.product_id is not null and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id)
    and not exists (
      select 1 from public.products product
      where product.id = new.product_id and product.tenant_id = new.tenant_id
    )
  then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;

  -- The wording before the first link belongs to the link: it is written or cleared with the article, never
  -- alone, so that no edit can make the line "remember" words the technician did not write.
  if new.pre_link_wording is not null and tg_op = 'INSERT' and new.product_id is null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE';
  end if;
  if tg_op = 'UPDATE' and new.pre_link_wording is distinct from old.pre_link_wording
    and new.product_id is not distinct from old.product_id then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE';
  end if;

  -- How a line was linked goes with its link: unlinked by the office, or erased by the article's deletion
  -- (ON DELETE SET NULL, which would otherwise fail the presence check and block the deletion). A match
  -- sent without an article, on a line that had none, is refused by that check.
  if tg_op = 'UPDATE' and old.product_id is not null and new.product_id is null then
    new.product_match := null;
  end if;

  -- TI-691 delivery 2: the price of a line (and the quantity it is for) is its retained quote's, and only the
  -- retaining writes it. A line is never created priced; it is priced once, while public.retain_material_request_quote
  -- runs for that very quote (the transaction-local marker it sets, which the Data API cannot set); the price then
  -- stays. The only other change is its clearing by the deletion of the quote itself (ON DELETE SET NULL, trigger
  -- depth > 1), the price going with it. A priced line keeps the quote's supplier. Neither is what the line says: a
  -- validated line stays validated.
  if tg_op = 'INSERT' then
    if new.price_quote_id is not null or new.unit_price_ht_cents is not null or new.price_per is distinct from 1 then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY';
    end if;
  elsif (new.price_quote_id, new.unit_price_ht_cents, new.price_per)
    is distinct from (old.price_quote_id, old.unit_price_ht_cents, old.price_per) then
    if pg_trigger_depth() > 1 and old.price_quote_id is not null and new.price_quote_id is null then
      new.unit_price_ht_cents := null;
      new.price_per := 1;
    elsif old.price_quote_id is not null or new.price_quote_id is null
      or pg_catalog.current_setting('app.material_request_quote_retaining', true) is distinct from new.price_quote_id::text
    then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY';
    else
      -- The retaining itself. A project line without its own material was consulted and validated in the request's
      -- confirmed presumed material, which the retaining now writes on it: that is not an edit of what it says.
      materialized := old.imputation = 'project' and btrim(coalesce(old.material, '')) = ''
        and new.material is distinct from old.material;
    end if;
  elsif old.price_quote_id is not null and new.supplier_id is distinct from old.supplier_id then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_SUPPLIER_FROM_QUOTE';
  end if;

  -- A priced line orders what its retained quote priced, at that price: its article, type, size, material, precision,
  -- reference, unit and quantity no longer change (a DN 50 priced is not ordered as a DN 65 at the DN 50 price). There
  -- is no way back in this delivery: a retained quote is not reopened. Its zone, imputation, the technician's words, the
  -- quantity doubt and the duplicate acknowledgement stay editable, and an article erased by its own deletion (ON
  -- DELETE SET NULL, trigger depth > 1) is not an edit.
  if tg_op = 'UPDATE' and old.price_quote_id is not null and new.price_quote_id is not null and pg_trigger_depth() = 1
    and (new.product_id, new.product_match, new.product_type, new.dimension, new.no_dimension, new.material,
      new.material_precision, new.reference, new.unit, new.quantity)
    is distinct from (old.product_id, old.product_match, old.product_type, old.dimension, old.no_dimension, old.material,
      old.material_precision, old.reference, old.unit, old.quantity)
  then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_PRICED';
  end if;

  -- A validated line always describes what was validated: changing what it says returns it to draft,
  -- even when the same statement keeps it validated. Position and the duplicate acknowledgement are
  -- not what it says, nor is its supplier (TI-691: the office's purchasing choice, made or changed on a
  -- validated line), and an article erased by its own deletion (trigger depth 2) is not an edit. Linking,
  -- changing or removing the article is. pre_link_wording is left out: it is what the line said before
  -- its link, not what it says, and it only changes with product_id, which is compared.
  if tg_op = 'UPDATE' and old.status = 'validated' and new.status = 'validated' and pg_trigger_depth() = 1 and (
    (new.original_text, new.quantity, new.quantity_doubtful, new.unit, new.dimension, new.no_dimension,
      new.product_type, case when materialized then old.material else new.material end, new.material_precision,
      new.reference, new.zone,
      new.imputation, new.overhead_category, new.product_id, new.product_match)
    is distinct from
    (old.original_text, old.quantity, old.quantity_doubtful, old.unit, old.dimension, old.no_dimension,
      old.product_type, old.material, old.material_precision, old.reference, old.zone,
      old.imputation, old.overhead_category, old.product_id, old.product_match)
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

-- A line bought at a retained price is not deleted alone: its retained quote would lose it. Deleting its request (or
-- affaire) still deletes it, in the cascade (trigger depth > 1).
create function private.guard_material_request_line_delete()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.price_quote_id is not null and pg_trigger_depth() = 1 then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_PRICED';
  end if;
  return old;
end;
$$;

create or replace function private.enforce_material_request_file_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent record;
  quote record;
  path_prefix text;
begin
  if tg_op = 'UPDATE' then
    -- The display rotation changes; the stored mark and the withdrawal are each set once.
    if (new.id, new.tenant_id, new.project_id, new.request_id, new.quote_id, new.storage_path, new.file_name,
        new.mime_type, new.byte_size, new.created_at)
      is distinct from (old.id, old.tenant_id, old.project_id, old.request_id, old.quote_id, old.storage_path,
        old.file_name, old.mime_type, old.byte_size, old.created_at) then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_IMMUTABLE';
    end if;
    -- TI-691: the answer of a retained or closed quote is read-only. The quote row is shared-locked, so that a
    -- retaining in progress (which locks it for update) is waited for: an upload prepared while the quote was open
    -- is not completed after its retaining; a listed file is neither turned nor withdrawn, except by the request's
    -- deletion (withdraw_material_request_files_for_deletion); a file never listed is withdrawn as usual.
    if new.quote_id is not null then
      select q.status into quote from public.material_request_quotes q where q.id = new.quote_id for share;
      if quote.status in ('retained', 'closed') and (
        (old.stored_at is null and new.stored_at is not null)
        or new.rotation is distinct from old.rotation
        or (old.stored_at is not null and old.removed_at is null and new.removed_at is not null
          and pg_catalog.current_setting('app.material_request_deleting', true) is distinct from new.request_id::text)
      ) then
        raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_READ_ONLY';
      end if;
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
      -- Twelve listed originals per request (MATERIAL_REQUEST_MAX_FILES in the application), and apart from them
      -- ten listed files per quote (MATERIAL_REQUEST_QUOTE_MAX_FILES). Marks on one request wait for each other on
      -- its row, so two uploads completed side by side cannot both pass.
      perform 1 from public.material_requests request where request.id = new.request_id for update;
      if new.quote_id is null then
        if (select count(*) from public.material_request_files other
            where other.request_id = new.request_id and other.quote_id is null and other.id <> new.id
              and other.stored_at is not null and other.removed_at is null) >= 12 then
          raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_LIMIT';
        end if;
      elsif (select count(*) from public.material_request_files other
          where other.quote_id = new.quote_id and other.id <> new.id
            and other.stored_at is not null and other.removed_at is null) >= 10 then
        raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_FILE_LIMIT';
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
  -- A quote's file answers a quote of the same request that still takes one: neither retained nor closed.
  if new.quote_id is not null then
    select q.request_id, q.status into quote from public.material_request_quotes q where q.id = new.quote_id;
    if quote.request_id is distinct from new.request_id then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_QUOTE_MISMATCH';
    end if;
    if quote.status in ('retained', 'closed') then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_READ_ONLY';
    end if;
  end if;
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

-- A listed file of a retained or closed quote is not deleted by a direct statement (its row is withdrawn first by the
-- application, which the file trigger refuses). Deleting its quote, request or affaire still deletes it (depth > 1).
create function private.guard_material_request_file_delete()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  quote record;
begin
  if old.quote_id is not null and old.stored_at is not null and old.removed_at is null and pg_trigger_depth() = 1 then
    select q.status into quote from public.material_request_quotes q where q.id = old.quote_id for share;
    if quote.status in ('retained', 'closed') then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_READ_ONLY';
    end if;
  end if;
  return old;
end;
$$;

revoke all on function private.guard_material_request_file_delete() from public, anon, authenticated;
revoke all on function private.enforce_material_request_quote_write() from public, anon, authenticated;
revoke all on function private.enforce_material_request_quote_line_write() from public, anon, authenticated;
revoke all on function private.guard_material_request_line_delete() from public, anon, authenticated;

create trigger enforce_material_request_quote_write
  before insert or update on public.material_request_quotes
  for each row execute function private.enforce_material_request_quote_write();
create trigger enforce_material_request_quote_line_write
  before insert or update on public.material_request_quote_lines
  for each row execute function private.enforce_material_request_quote_line_write();
create trigger guard_material_request_line_delete
  before delete on public.material_request_lines
  for each row execute function private.guard_material_request_line_delete();
create trigger guard_material_request_file_delete
  before delete on public.material_request_files
  for each row execute function private.guard_material_request_file_delete();

-- ---------------------------------------------------------------------------
-- Rights, in the pattern of the lines.
-- ---------------------------------------------------------------------------
alter table public.material_request_quotes enable row level security;
alter table public.material_request_quotes force row level security;
alter table public.material_request_quote_lines enable row level security;
alter table public.material_request_quote_lines force row level security;

revoke all on public.material_request_quotes, public.material_request_quote_lines from public, anon, authenticated;
-- Quotes are closed, never deleted by a client: a closed quote stays readable. Their lines go with them.
grant select, insert, update on public.material_request_quotes, public.material_request_quote_lines to authenticated;
grant select, insert, update, delete on public.material_request_quotes, public.material_request_quote_lines to service_role;

create policy "Affaire readers read material request quotes"
  on public.material_request_quotes for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );
create policy "Affaire operators add material request quotes"
  on public.material_request_quotes for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Affaire operators change material request quotes"
  on public.material_request_quotes for update to authenticated
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

create policy "Affaire readers read material request quote lines"
  on public.material_request_quote_lines for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );
create policy "Affaire operators add material request quote lines"
  on public.material_request_quote_lines for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
    and (select public.has_tenant_role((select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );
create policy "Affaire operators change material request quote lines"
  on public.material_request_quote_lines for update to authenticated
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

-- ---------------------------------------------------------------------------
-- 4. Writing quotes, as the caller (RLS decides who), one statement each.
-- ---------------------------------------------------------------------------
-- A quote and the lines it asks for, all or nothing: 1 to 300 distinct lines of the request, none priced yet. The
-- lines are inserted in id order, the order in which a retaining locks them, under the marker that lets only this
-- function write the lines of a quote. The one-open-quote-per-supplier rule
-- answers 23505 (material_request_quotes_open_supplier_key).
create function public.create_material_request_quote(
  p_request_id uuid,
  p_supplier_id uuid,
  p_with_references boolean,
  p_message text,
  p_line_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  if p_line_ids is null or pg_catalog.cardinality(p_line_ids) not between 1 and 300
    or pg_catalog.array_position(p_line_ids, null) is not null
    or (select count(distinct wanted.id) from pg_catalog.unnest(p_line_ids) as wanted(id)) <> pg_catalog.cardinality(p_line_ids)
  then
    raise exception using errcode = '22023', message = 'MATERIAL_REQUEST_QUOTE_LINES_INVALID';
  end if;

  insert into public.material_request_quotes (request_id, supplier_id, with_references, message, created_by)
  values (p_request_id, p_supplier_id, p_with_references, p_message, (select auth.uid()))
  returning id into created_id;

  perform pg_catalog.set_config('app.material_request_quote_creating', created_id::text, true);
  insert into public.material_request_quote_lines (quote_id, line_id)
  select created_id, wanted.id from pg_catalog.unnest(p_line_ids) as wanted(id) order by wanted.id;
  perform pg_catalog.set_config('app.material_request_quote_creating', '', true);

  return created_id;
end;
$$;

comment on function public.create_material_request_quote(uuid, uuid, boolean, text, uuid[]) is
  'TI-691: records a quote asked of a supplier (status requested) with the lines it asks for, in one statement, as the caller (RLS). 1 to 300 distinct lines (MATERIAL_REQUEST_QUOTE_LINES_INVALID) of the request (MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_REQUEST), none already retained (MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED); a supplier of the tenant (MATERIAL_REQUEST_TENANT_MISMATCH) with no other quote requested or received on the request (23505). Returns the quote id.';

-- Prices, total, notes and reception of a requested or received quote, all or nothing. p_changes: an object whose
-- keys are optional; a key left out is left alone, null clears it.
--   amount_ht_cents: integer cents >= 0 or null; notes: text or null; received: true (from requested);
--   lines: [{line_id, unit_price_ht_cents: integer cents >= 0 or null, price_per?: 1, 10, 100 or 1000 units, left
--   alone when omitted}], 1 to 300 distinct lines of this quote.
create function public.update_material_request_quote(p_quote_id uuid, p_changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target record;
  written integer;
begin
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_changes) as change(key)
      where change.key not in ('amount_ht_cents', 'notes', 'lines', 'received')
    )
    or (p_changes ? 'amount_ht_cents' and pg_catalog.jsonb_typeof(p_changes -> 'amount_ht_cents') <> 'null'
      and coalesce(p_changes ->> 'amount_ht_cents', '') !~ '^[0-9]{1,10}$')
    or (p_changes ? 'notes' and pg_catalog.jsonb_typeof(p_changes -> 'notes') not in ('string', 'null'))
    or (p_changes ? 'received' and p_changes -> 'received' <> 'true'::jsonb)
    or (p_changes ? 'lines' and (
      pg_catalog.jsonb_typeof(p_changes -> 'lines') <> 'array'
      or pg_catalog.jsonb_array_length(p_changes -> 'lines') not between 1 and 300
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(p_changes -> 'lines') as entry(line)
        where pg_catalog.jsonb_typeof(entry.line) <> 'object'
          or pg_catalog.jsonb_typeof(entry.line -> 'line_id') is distinct from 'string'
          or not (entry.line ? 'unit_price_ht_cents')
          or (pg_catalog.jsonb_typeof(entry.line -> 'unit_price_ht_cents') <> 'null'
            and coalesce(entry.line ->> 'unit_price_ht_cents', '') !~ '^[0-9]{1,10}$')
          or (entry.line ? 'price_per' and (pg_catalog.jsonb_typeof(entry.line -> 'price_per') <> 'number'
            or (entry.line ->> 'price_per') not in ('1', '10', '100', '1000')))
      )
      or (select count(distinct entry.line ->> 'line_id') from pg_catalog.jsonb_array_elements(p_changes -> 'lines') as entry(line))
        <> pg_catalog.jsonb_array_length(p_changes -> 'lines')
    ))
  then
    raise exception using errcode = '22023', message = 'MATERIAL_REQUEST_QUOTE_CHANGES_INVALID';
  end if;

  -- Locked for update: a retaining or a closing of this quote waits, or has already happened and is seen here. A
  -- quote the caller reads but may not change is not locked.
  select q.id, q.status into target from public.material_request_quotes q where q.id = p_quote_id for update;
  if not found then
    if exists (select 1 from public.material_request_quotes q where q.id = p_quote_id) then
      raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_QUOTE_WRITERS_ONLY';
    end if;
    raise exception using errcode = 'P0002', message = 'MATERIAL_REQUEST_QUOTE_NOT_FOUND';
  end if;
  if target.status not in ('requested', 'received') then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_READ_ONLY';
  end if;

  if p_changes ? 'lines' then
    update public.material_request_quote_lines quote_line
    set unit_price_ht_cents = (entry.line ->> 'unit_price_ht_cents')::bigint,
        price_per = case when entry.line ? 'price_per' then (entry.line ->> 'price_per')::integer else quote_line.price_per end
    from pg_catalog.jsonb_array_elements(p_changes -> 'lines') as entry(line)
    where quote_line.quote_id = target.id and quote_line.line_id = (entry.line ->> 'line_id')::uuid;
    get diagnostics written = row_count;
    if written <> pg_catalog.jsonb_array_length(p_changes -> 'lines') then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_QUOTE';
    end if;
  end if;

  update public.material_request_quotes q
  set amount_ht_cents = case when p_changes ? 'amount_ht_cents'
        then (p_changes ->> 'amount_ht_cents')::bigint else q.amount_ht_cents end,
      notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else q.notes end,
      status = case when p_changes ? 'received' and q.status = 'requested' then 'received' else q.status end
  where q.id = target.id;
end;
$$;

comment on function public.update_material_request_quote(uuid, jsonb) is
  'TI-691: changes the prices of a quote''s lines (whole cents for price_per units: 1, 10, 100 or 1000), its total, its notes and/or marks it received (from requested), in one statement, as the caller (RLS), while it is requested or received (MATERIAL_REQUEST_QUOTE_READ_ONLY). Keys left out are left alone (MATERIAL_REQUEST_QUOTE_CHANGES_INVALID for any other key or value); every priced line is one of the quote''s (MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_QUOTE).';

-- Retaining a quote, in one transaction, as the caller (RLS: the writers of the request's lines and quotes):
--  1. every quote of the request still requested or received is locked for update, in id order: retainings, price
--     changes and closings of one request wait for each other, and two retainings cannot both pass;
--  2. the quote must be received, ask for at least one line, every one priced, none already priced by another
--     retained quote, every one validated under the lock of the lines (MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED:
--     retaining freezes what a line orders, so it is complete first) (coded refusals; DETAIL holds the positions of
--     the lines concerned, as a JSON array). A priced line may later be reopened to draft and validated again: its
--     status is not what it orders, and what it orders is complete;
--  3. it becomes retained (dated and signed by the database);
--  4. its lines, locked in id order, take its supplier, their price and the quantity it is for, and the quote's id; a
--     project line without a material of its own was consulted, and validated, in the request's presumed material:
--     it takes that material, which must be confirmed now (MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED, DETAIL: the
--     positions), so that the price stays tied to it once the freeze of a priced line holds it (a later change of the
--     header's material no longer reaches the line); an overhead line is not touched; a validated line stays
--     validated. The request row is shared-locked before the lines, against a change of that material meanwhile;
--  5. every other requested or received quote of the request that shares a line with it is closed.
-- Answers the quotes closed in step 5.
create function public.retain_material_request_quote(p_quote_id uuid)
returns table (closed_quote_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target record;
  presumed record;
  positions integer[];
  line_count integer;
  priced integer;
  closed_ids uuid[];
begin
  select q.request_id into target from public.material_request_quotes q where q.id = p_quote_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'MATERIAL_REQUEST_QUOTE_NOT_FOUND';
  end if;
  perform 1 from public.material_request_quotes q
  where q.request_id = target.request_id and q.status in ('requested', 'received')
  order by q.id
  for update;
  -- Read again under the locks: a competing retaining that committed meanwhile has closed it.
  select q.id, q.request_id, q.supplier_id, q.status into target
  from public.material_request_quotes q where q.id = p_quote_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_QUOTE_WRITERS_ONLY';
  end if;
  if target.status <> 'received' then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_NOT_RECEIVED', detail = target.status;
  end if;

  select count(*) into line_count from public.material_request_quote_lines quote_line where quote_line.quote_id = target.id;
  if line_count = 0 then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_WITHOUT_LINES';
  end if;
  select pg_catalog.array_agg(line.position order by line.position) into positions
  from public.material_request_quote_lines quote_line
  join public.material_request_lines line on line.id = quote_line.line_id
  where quote_line.quote_id = target.id and quote_line.unit_price_ht_cents is null;
  if positions is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_UNPRICED',
      detail = pg_catalog.array_to_json(positions)::text;
  end if;

  -- The request first (as a validation of its lines does, and before them, like a change of its header): its
  -- presumed material stays as read here until this retaining commits.
  select request.presumed_material, request.material_confirmed into presumed
  from public.material_requests request where request.id = target.request_id for share;
  perform 1 from public.material_request_lines line
  where line.id in (
    select quote_line.line_id from public.material_request_quote_lines quote_line where quote_line.quote_id = target.id
  )
  order by line.id
  for update;
  select pg_catalog.array_agg(line.position order by line.position) into positions
  from public.material_request_quote_lines quote_line
  join public.material_request_lines line on line.id = quote_line.line_id
  where quote_line.quote_id = target.id and line.price_quote_id is not null;
  if positions is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED',
      detail = pg_catalog.array_to_json(positions)::text;
  end if;
  select pg_catalog.array_agg(line.position order by line.position) into positions
  from public.material_request_quote_lines quote_line
  join public.material_request_lines line on line.id = quote_line.line_id
  where quote_line.quote_id = target.id and line.status <> 'validated';
  if positions is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED',
      detail = pg_catalog.array_to_json(positions)::text;
  end if;
  -- A backstop since the rule above: a validated line relying on the presumed material is reopened when it is
  -- withdrawn, and the request is shared-locked since.
  select pg_catalog.array_agg(line.position order by line.position) into positions
  from public.material_request_quote_lines quote_line
  join public.material_request_lines line on line.id = quote_line.line_id
  where quote_line.quote_id = target.id and line.imputation = 'project' and pg_catalog.btrim(coalesce(line.material, '')) = '';
  if positions is not null
    and (pg_catalog.btrim(coalesce(presumed.presumed_material, '')) = '' or not coalesce(presumed.material_confirmed, false))
  then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED',
      detail = pg_catalog.array_to_json(positions)::text;
  end if;

  perform pg_catalog.set_config('app.material_request_quote_retaining', target.id::text, true);
  update public.material_request_quotes q set status = 'retained' where q.id = target.id;
  update public.material_request_lines line
  set supplier_id = target.supplier_id,
      unit_price_ht_cents = quote_line.unit_price_ht_cents,
      price_per = quote_line.price_per,
      price_quote_id = target.id,
      material = case when line.imputation = 'project' and pg_catalog.btrim(coalesce(line.material, '')) = ''
        then presumed.presumed_material else line.material end
  from public.material_request_quote_lines quote_line
  where quote_line.quote_id = target.id and line.id = quote_line.line_id and line.price_quote_id is null;
  get diagnostics priced = row_count;
  perform pg_catalog.set_config('app.material_request_quote_retaining', '', true);
  -- Every line of the quote is priced, or nothing is (a line the caller may not change is not written by RLS).
  if priced <> line_count then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_CHANGED';
  end if;

  with closed as (
    update public.material_request_quotes other
    set status = 'closed'
    where other.request_id = target.request_id
      and other.id <> target.id
      and other.status in ('requested', 'received')
      and exists (
        select 1
        from public.material_request_quote_lines theirs
        join public.material_request_quote_lines mine on mine.line_id = theirs.line_id and mine.quote_id = target.id
        where theirs.quote_id = other.id
      )
    returning other.id
  )
  select coalesce(pg_catalog.array_agg(closed.id order by closed.id), '{}'::uuid[]) into closed_ids from closed;

  return query select closed.id from pg_catalog.unnest(closed_ids) as closed(id);
end;
$$;

comment on function public.retain_material_request_quote(uuid) is
  'TI-691: retains a received quote whose lines are all priced and validated, in one transaction, as the caller (RLS): it becomes retained, its lines take its supplier, price, price quantity and id, and a project line without its own material takes the request''s confirmed presumed material (a validated line stays validated), and every other requested or received quote of the request sharing a line is closed; returns their ids. Refusals: MATERIAL_REQUEST_QUOTE_NOT_FOUND, _WRITERS_ONLY, _NOT_RECEIVED (DETAIL: status), _WITHOUT_LINES, _LINES_UNPRICED, _LINES_ALREADY_RETAINED, _LINES_NOT_VALIDATED and _MATERIAL_UNCONFIRMED (DETAIL: JSON array of line positions), _LINES_CHANGED.';

-- The first step of a request's deletion: every file of the request is withdrawn (hidden from every reader, no upload
-- lands at its path any more), those of retained or closed quotes included, and their paths answered so that the
-- application removes their bytes before it deletes the request. As the caller (RLS): a file the caller may not
-- change is not withdrawn, so only the writers of the affaire, who may delete the request itself, reach this. The
-- paths come back as one array value: the Data API answers 1 000 rows at most (max_rows), and a request may hold more
-- files across its quotes (12 originals and 10 files per quote).
create function public.withdraw_material_request_files_for_deletion(p_request_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  paths text[];
begin
  perform pg_catalog.set_config('app.material_request_deleting', p_request_id::text, true);
  with withdrawn as (
    update public.material_request_files file
    set removed_at = pg_catalog.now()
    where file.request_id = p_request_id
    returning file.storage_path
  )
  select coalesce(pg_catalog.array_agg(withdrawn.storage_path order by withdrawn.storage_path), '{}'::text[])
  into paths from withdrawn;
  perform pg_catalog.set_config('app.material_request_deleting', '', true);
  return paths;
end;
$$;

comment on function public.withdraw_material_request_files_for_deletion(uuid) is
  'TI-691: withdraws every file of a request before its deletion (originals and quote files, retained or closed quotes included), as the caller (RLS), and returns their storage paths, all of them in one array, for the removal of their bytes.';

revoke all on function public.withdraw_material_request_files_for_deletion(uuid) from public, anon;
grant execute on function public.withdraw_material_request_files_for_deletion(uuid) to authenticated;
revoke all on function public.create_material_request_quote(uuid, uuid, boolean, text, uuid[]) from public, anon;
revoke all on function public.update_material_request_quote(uuid, jsonb) from public, anon;
revoke all on function public.retain_material_request_quote(uuid) from public, anon;
grant execute on function public.create_material_request_quote(uuid, uuid, boolean, text, uuid[]) to authenticated;
grant execute on function public.update_material_request_quote(uuid, jsonb) to authenticated;
grant execute on function public.retain_material_request_quote(uuid) to authenticated;

commit;

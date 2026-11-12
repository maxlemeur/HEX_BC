-- TI-690: the 300-line cap of a material request is held by the database.
-- The application counted the lines, then inserted: two sessions appending to a request that holds 299 lines
-- both read 299 and passed, and the position-conflict retry let the second land at position 301. Beyond the
-- advertised limit, "select all" and "validate all" then failed, since those calls accept 300 ids at most.
--
-- The line trigger now takes the request row first and counts under that lock, so two concurrent appends
-- cannot both pass, and a batch that would cross the cap fails as a whole. The application keeps its own
-- count for the friendly early refusal and maps this one to the same answer.
--
-- Copied from 20261112014046_material_requests.sql; only the cap, in the insert branch, is new.

begin;

create or replace function private.enforce_material_request_line_write()
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

commit;

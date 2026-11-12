-- TI-690, delivery 3 (« le rapprochement »): each line of a material request is linked to a catalogue article.
-- No remote application is authorized here.
--
-- - material_request_lines.product_id: the article the office chose for the line (null: none yet). An article
--   of another tenant is refused (MATERIAL_REQUEST_TENANT_MISMATCH). Deleting the article unlinks the line.
-- - material_request_lines.product_match: how it was linked, null exactly when there is no article. When the
--   article goes (unlinked by the office, or deleted from the catalogue), the trigger clears it with the link;
--   a client that sends a match without an article is refused by the check.
-- - material_request_lines.pre_link_wording: the line's own wording (type, material, precision, size, unit)
--   as it stood before its first link, kept by the application so that the usual name it teaches is the
--   technician's words and an unlink gives them back. Never sent to the browser. It changes only in the
--   statement that sets or clears the article (MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE), and is an object.
-- - Linking, changing or removing the article changes what a validated line says: it returns to draft, like
--   any other edit (the trigger's backstop now compares both columns). The article erased by its own deletion
--   (trigger depth 2) is not an edit, as for a deleted supplier.
-- - public.product_aliases: the usual names the office teaches an article when it links a line (« noms
--   usuels »), compared by their key (words folded and sorted, computed by the application). Read by the
--   members of the tenant; added by its admins and engineers; deleted by an admin or by the member who added
--   it; never changed. The tenant is the article's.
-- - products.created_from_material_request: the article was created from a request line (the catalogue shows
--   « Nouveau » on such a draft until it is validated). Set at insert, immutable afterwards
--   (PRODUCT_ORIGIN_IMMUTABLE).
--
-- private.enforce_material_request_line_write() is copied from 20261112021509_material_request_line_cap.sql;
-- only the article's tenant check, the clearing of the match, the guard of pre_link_wording and the two columns
-- of the backstop are new.
-- Regression: supabase/tests/database/material-request-articles.test.sql.

begin;

do $preflight$
begin
  if to_regclass('public.material_request_lines') is null
    or to_regclass('public.products') is null
    or to_regprocedure('private.enforce_material_request_line_write()') is null
    or to_regprocedure('public.has_tenant_role(uuid, public.tenant_role[])') is null
    or to_regprocedure('public.is_tenant_member(uuid)') is null
  then
    raise exception 'TI690_ARTICLES_PREREQUISITE_MISSING';
  end if;
  if to_regclass('public.product_aliases') is not null then
    raise exception 'TI690_ARTICLES_PREFLIGHT: public.product_aliases already exists';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The article of a line.
-- ---------------------------------------------------------------------------
alter table public.material_request_lines
  add column product_id uuid references public.products(id) on delete set null,
  add column product_match text,
  add column pre_link_wording jsonb,
  add constraint material_request_lines_pre_link_wording_check
    check (pre_link_wording is null or jsonb_typeof(pre_link_wording) = 'object'),
  add constraint material_request_lines_product_match_check
    check (product_match in ('reference', 'alias', 'ranked', 'manual', 'created')),
  add constraint material_request_lines_product_match_presence_check
    check ((product_id is null) = (product_match is null));

comment on column public.material_request_lines.product_id is
  'TI-690: catalogue article linked by the office (same tenant). Its wording fills the line; original_text and reference keep the technician''s words.';
comment on column public.material_request_lines.product_match is
  'TI-690: how the article was linked (reference, alias, ranked: a proposal; manual: chosen by hand; created: created from the line). Null exactly when product_id is null.';

comment on column public.material_request_lines.pre_link_wording is
  'TI-690: the line''s wording before its first link (product_type, material, material_precision, dimension, no_dimension, unit, quantity_doubtful), written by the application''s link and cleared by its unlink, which restores it. Server-side only.';

create index material_request_lines_product_idx on public.material_request_lines (product_id);

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

  -- A validated line always describes what was validated: changing what it says returns it to draft,
  -- even when the same statement keeps it validated. Position and the duplicate acknowledgement are
  -- not what it says, and a supplier or an article erased by its own deletion (trigger depth 2) is not
  -- an edit. Linking, changing or removing the article is. pre_link_wording is left out: it is what the
  -- line said before its link, not what it says, and it only changes with product_id, which is compared.
  if tg_op = 'UPDATE' and old.status = 'validated' and new.status = 'validated' and pg_trigger_depth() = 1 and (
    (new.original_text, new.quantity, new.quantity_doubtful, new.unit, new.dimension, new.no_dimension,
      new.product_type, new.material, new.material_precision, new.reference, new.supplier_id, new.zone,
      new.imputation, new.overhead_category, new.product_id, new.product_match)
    is distinct from
    (old.original_text, old.quantity, old.quantity_doubtful, old.unit, old.dimension, old.no_dimension,
      old.product_type, old.material, old.material_precision, old.reference, old.supplier_id, old.zone,
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

-- ---------------------------------------------------------------------------
-- 2. Articles created from a request line.
-- ---------------------------------------------------------------------------
alter table public.products
  add column created_from_material_request boolean not null default false;

comment on column public.products.created_from_material_request is
  'TI-690: created from a material request line (the catalogue shows « Nouveau » on such a draft until it is validated). Set at insert only.';

create function private.freeze_product_material_request_origin()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.created_from_material_request is distinct from old.created_from_material_request then
    raise exception using errcode = '23514', message = 'PRODUCT_ORIGIN_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function private.freeze_product_material_request_origin() from public, anon, authenticated;

create trigger freeze_product_material_request_origin
  before update on public.products
  for each row execute function private.freeze_product_material_request_origin();

-- ---------------------------------------------------------------------------
-- 3. Usual names of an article.
-- ---------------------------------------------------------------------------
create table public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete cascade,
  -- The words as the technician wrote them (the line's type before the link), shown in the catalogue.
  alias text not null check (char_length(alias) between 1 and 200),
  -- What the matcher compares: the words folded and sorted (aliasKey in src/lib/material-requests/matching.ts).
  alias_key text not null check (char_length(alias_key) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint product_aliases_product_alias_key unique (tenant_id, product_id, alias_key)
);

comment on table public.product_aliases is
  'TI-690: usual names the office taught for a catalogue article, learned when it links a request line. Same tenant as the article; never updated.';

create index product_aliases_product_idx on public.product_aliases (product_id);
create index product_aliases_created_by_idx on public.product_aliases (created_by);

-- The tenant is the article's, never the client's; the date is the database's, and a signed-in member is the
-- author. Runs as the caller: an article the caller cannot read is one that does not exist. The insert policy
-- then requires that tenant to be the caller's active one, so an article of another of their tenants is refused.
create function private.enforce_product_alias_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  product_tenant_id uuid;
begin
  select product.tenant_id into product_tenant_id from public.products product where product.id = new.product_id;
  if product_tenant_id is null then
    raise exception using errcode = '23514', message = 'PRODUCT_ALIAS_TENANT_MISMATCH';
  end if;
  new.tenant_id := product_tenant_id;
  new.created_at := now();
  if (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_product_alias_write() from public, anon, authenticated;

create trigger enforce_product_alias_write
  before insert on public.product_aliases
  for each row execute function private.enforce_product_alias_write();

alter table public.product_aliases enable row level security;
alter table public.product_aliases force row level security;

revoke all on public.product_aliases from public, anon, authenticated;
grant select, insert, delete on public.product_aliases to authenticated;
grant select, insert, update, delete on public.product_aliases to service_role;

create policy "Tenant members read product aliases"
  on public.product_aliases for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Catalogue editors add product aliases"
  on public.product_aliases for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );

create policy "Admins and authors delete product aliases"
  on public.product_aliases for delete to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    or (created_by = (select auth.uid()) and (select public.is_tenant_member(tenant_id)))
  );

commit;

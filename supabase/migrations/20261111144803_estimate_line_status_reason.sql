-- TI-682, lot C, PR 3 (D11, D25) : le motif interne d'une exclusion.
-- Une prestation nécessaire laissée « Non chiffrée » puis classée avec un statut que le client lit (« Inclus »,
-- « Pour mémoire », « Hors lot », « Sans objet ») dit pourquoi, en interne. Le motif ne sort jamais : ni contrat
-- client, ni sceau, ni PDF, ni portail ; seulement le CSV interne. L'envoi est refusé tant qu'une telle ligne n'a pas
-- de motif (excluded_without_reason, contrôle d'envoi TypeScript, ni rétrogradable ni forçable).
-- Additive : deux colonnes nulles ou fausses, aucune ligne existante n'est réécrite (ADD COLUMN … DEFAULT ne passe pas
-- par les déclencheurs) ; une ligne « Non chiffrée » d'avant cette migration devient « a été Non chiffrée » à son
-- premier changement de statut. Aucun montant, aucun sceau, aucun contrat client ne change.
-- Écriture : commit_estimate_batch (nouvelle clé de ligne status_reason, création et mise à jour), par tout rôle qui
-- écrit la ligne. was_not_priced n'est jamais une entrée : le déclencheur le pose. Sur une v3, les gardes existantes
-- (aay_guard_estimate_item_engine_columns, aaz_guard_estimate_v2_snapshot_columns) refusent l'écriture directe et
-- gèlent la ligne hors brouillon ; le déclencheur ci-dessous tourne après elles et ne change rien sans changement de
-- statut. Une duplication de version recopie les deux colonnes ; copie de section et insertion de modèle n'en
-- recopient aucune (listes de colonnes explicites).
-- Codes provisoires jusqu'à l'accord du propriétaire, tenus égaux à src/lib/estimates/status-reason.ts.
begin;

-- Forme d'un motif : un code de la liste et une note nulle, ou de 10 à 500 caractères une fois rognée des blancs ASCII
-- (mesure des notes du métré) ; « other » n'a de sens que par sa note.
create function public.estimate_status_reason_valid(p_reason jsonb) returns boolean
language sql immutable set search_path = '' as $valid$
  select coalesce(
    pg_catalog.jsonb_typeof(p_reason) = 'object'
    and p_reason ?& array['code', 'note']
    and p_reason - array['code', 'note'] = '{}'::jsonb
    and pg_catalog.jsonb_typeof(p_reason -> 'code') = 'string'
    and p_reason ->> 'code' in ('other_trade', 'client_supplied', 'included_elsewhere', 'not_required_after_check',
      'dpgf_memory_item', 'other')
    and pg_catalog.jsonb_typeof(p_reason -> 'note') in ('string', 'null')
    and case
      when p_reason -> 'note' = 'null'::jsonb then p_reason ->> 'code' <> 'other'
      else pg_catalog.char_length(pg_catalog.regexp_replace(p_reason ->> 'note', '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'))
        between 10 and 500
    end,
    false)
$valid$;
revoke all on function public.estimate_status_reason_valid(jsonb) from public, anon, authenticated, service_role;
-- Pure : ni lecture ni écriture. La contrainte CHECK et le lot l'appellent sous le rôle de l'écrivain.
grant execute on function public.estimate_status_reason_valid(jsonb) to authenticated, service_role;
comment on function public.estimate_status_reason_valid(jsonb) is
  'TI-682: shape of estimate_items.status_reason ({code, note}); codes provisional, kept equal to src/lib/estimates/status-reason.ts.';

alter table public.estimate_items add column status_reason jsonb;
alter table public.estimate_items add column was_not_priced boolean not null default false;
alter table public.estimate_items add constraint estimate_items_status_reason_check check (
  status_reason is null or (
    pricing_status in ('included', 'for_memory', 'out_of_scope', 'not_applicable')
    and public.estimate_status_reason_valid(status_reason)
  )
);
comment on column public.estimate_items.status_reason is
  'TI-682: internal reason of an exclusion ({code, note}), on an Inclus / Pour mémoire / Hors lot / Sans objet line only. Never in the client contract, the seal, the PDF or the portal. Written by commit_estimate_batch; cleared when the status leaves these four.';
comment on column public.estimate_items.was_not_priced is
  'TI-682: the line has been « Non chiffrée » in this version (sticky). Set by private.track_estimate_item_status_reason only, never an input; copied by version duplication.';

-- « A été Non chiffrée » et effacement du motif. Nommé après aaz_ : il ne tourne que sur une écriture déjà admise par
-- le contrat d'écrivain v3 et la garde de gel. Sans requête (budget d'instructions des gros devis). Sans changement de
-- statut, il remet les valeurs en place : ni l'API de données d'une v1/v2, ni une écriture neutre d'une version émise
-- ne changent l'indicateur. Le motif s'efface quand le statut quitte les quatre statuts sans motif nouveau (un collage
-- ou une saisie en masse qui rechiffre une ligne n'échoue pas) ; un motif nouveau sur un autre statut est refusé par le
-- CHECK. À l'insertion, l'indicateur fourni est gardé (duplication de version) et vaut vrai pour une ligne « Non chiffrée ».
create function private.track_estimate_item_status_reason()
returns trigger language plpgsql set search_path = '' as $track$
begin
  if tg_op = 'INSERT' then
    new.was_not_priced := coalesce(new.was_not_priced, false) or new.pricing_status = 'not_priced';
    return new;
  end if;
  if new.pricing_status is distinct from old.pricing_status then
    new.was_not_priced := old.was_not_priced or old.pricing_status = 'not_priced' or new.pricing_status = 'not_priced';
    if new.pricing_status not in ('included', 'for_memory', 'out_of_scope', 'not_applicable')
      and new.status_reason is not distinct from old.status_reason
    then
      new.status_reason := null;
    end if;
  else
    new.was_not_priced := old.was_not_priced;
  end if;
  return new;
end;
$track$;
revoke all on function private.track_estimate_item_status_reason() from public, anon, authenticated, service_role;
create trigger ae_track_estimate_item_status_reason before insert or update on public.estimate_items
  for each row execute function private.track_estimate_item_status_reason();


-- Latest owning definition: 20261109183432_estimate_fo_price_origin.sql. Added only the status_reason line key (TI-682).
CREATE OR REPLACE FUNCTION private.canonical_estimate_batch_operations(operations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare op jsonb; result jsonb[]:='{}'; data jsonb; pair record; key text; value jsonb; name text;
  common_keys text[]:=array['parent_id','position','title','aid'];
  line_keys text[]:=array['line_nature','description','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id','fo_price_origin','unit_code','pricing_status','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit','status_reason']; -- TI-682 (ajout) : status_reason
  source_keys text[]:=array['source_provider','source_job_id','source_file_name','source_page'];
  money_keys text[]:=array['pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'];
  allowed text[];
begin
  if jsonb_typeof(operations) is distinct from 'array' or jsonb_array_length(operations) not between 1 and 1000 or octet_length(operations::text)>1048576 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  for op in select * from jsonb_array_elements(operations) loop
    name:=op->>'op';
    if jsonb_typeof(op) is distinct from 'object' or name not in('create','update','delete','reorder') or name is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if op - (case name when 'create' then array['op','data'] when 'update' then array['op','id','data'] when 'delete' then array['op','id'] else array['op','data'] end) <> '{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if name in('update','delete') then
      if jsonb_typeof(op->'id') is distinct from 'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      op:=jsonb_set(op,'{id}',to_jsonb((op->>'id')::uuid));
    end if;
    if name='delete' then result:=array_append(result,op); continue; end if;
    data:=op->'data';
    if jsonb_typeof(data) is distinct from 'object' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if name='reorder' then
      if data-array['parent_id','ordered_ids']<>'{}'::jsonb or jsonb_typeof(data->'ordered_ids') is distinct from 'array' or jsonb_array_length(data->'ordered_ids')<1 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if exists(select 1 from jsonb_array_elements(data->'ordered_ids') x where jsonb_typeof(x)<>'string') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      select jsonb_agg(to_jsonb((x.value#>>'{}')::uuid) order by x.ordinality) into value from jsonb_array_elements(data->'ordered_ids') with ordinality x;
      data:=jsonb_set(data,'{ordered_ids}',value);
      if data ? 'parent_id' and data->'parent_id'<>'null'::jsonb then data:=jsonb_set(data,'{parent_id}',to_jsonb((data->>'parent_id')::uuid)); end if;
      result:=array_append(result,jsonb_set(op,'{data}',data)); continue;
    end if;
    if name='create' then
      if data->>'item_type' not in('line','section') or data->>'item_type' is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      allowed:=common_keys||source_keys||array['item_type']||case when data->>'item_type'='line' then line_keys else '{}'::text[] end;
    else allowed:=common_keys||line_keys||money_keys; end if;
    if data-allowed<>'{}'::jsonb or data='{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    for pair in select * from jsonb_each(data) loop
      key:=pair.key; value:=pair.value;
      if key in('parent_id','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','category_id','supply_type_id','product_id','selected_supplier_price_id','source_job_id') then
        if value<>'null'::jsonb then
          if jsonb_typeof(value)<>'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          data:=jsonb_set(data,array[key],to_jsonb((data->>key)::uuid));
        end if;
      elsif key='fo_price_origin' then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'object' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      elsif key='status_reason' then -- TI-682 (ajout) : motif interne d'une exclusion, nul pour l'effacer
        if value<>'null'::jsonb then -- TI-682 (ajout)
          if jsonb_typeof(value)<>'object' or value-array['code','note']<>'{}'::jsonb or value ? 'note' and jsonb_typeof(value->'note') not in('string','null') then perform private.estimate_batch_error('INVALID_INPUT'); end if; -- TI-682 (ajout)
          -- TI-682 (ajout) : note sans les blancs ASCII des deux bouts (comme les notes du métré), nulle si vide.
          value:=jsonb_build_object('code',value->'code','note',coalesce(to_jsonb(nullif(regexp_replace(coalesce(value->>'note',''),'^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$','','g'),'')),'null'::jsonb)); -- TI-682 (ajout)
          if not public.estimate_status_reason_valid(value) then perform private.estimate_batch_error('INVALID_INPUT'); end if; -- TI-682 (ajout)
          data:=jsonb_set(data,array[key],value); -- TI-682 (ajout)
        end if; -- TI-682 (ajout)
      elsif key='unit_code' then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        data:=jsonb_set(data,array[key],coalesce(to_jsonb(nullif(btrim(data->>key),'')),'null'));
      elsif key='pricing_status' then
        if jsonb_typeof(value)<>'string' or data->>key not in('priced','included','for_memory','not_priced','out_of_scope','not_applicable') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      elsif key in('title','aid','description','source_provider','source_file_name') then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'string' or key='title' and (value='null'::jsonb or btrim(data->>key)='') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        data:=jsonb_set(data,array[key],coalesce(to_jsonb(case when key='aid' then upper(nullif(btrim(data->>key),'')) when key='title' then btrim(data->>key) else nullif(btrim(data->>key),'') end),'null'));
      elsif key in('item_type','line_nature') then
        if jsonb_typeof(value)<>'string' or key='line_nature' and data->>key not in('supply_only','supply_and_labor','labor_only') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      else
        if value='null'::jsonb and key in('h_mo_atelier','k_mo_atelier','h_mo_chantier','k_mo_chantier','source_page','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit') then continue; end if;
        if jsonb_typeof(value)<>'number' or (data->>key)::numeric<0 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if key in('position','source_page','unit_price_ht_cents','tax_rate_bp') or key=any(money_keys) then
          if (data->>key)::numeric<>trunc((data->>key)::numeric) or (data->>key)::numeric>2147483647 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        end if;
        if key in('position','source_page') and (data->>key)::numeric<1 or key='tax_rate_bp' and (data->>key)::numeric>10000 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if key in('h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit') and (min_scale((data->>key)::numeric)>4 or (data->>key)::numeric>99999999.9999) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      end if;
    end loop;
    result:=array_append(result,jsonb_set(op,'{data}',data));
  end loop;
  return to_jsonb(result);
exception when invalid_text_representation or numeric_value_out_of_range then perform private.estimate_batch_error('INVALID_INPUT'); return null;
end $function$;


-- Latest owning definition: 20261109183432_estimate_fo_price_origin.sql. Added only status_reason to the inserts and the update,
-- and the two new columns left out of each returned item at their default value (TI-682): an ordinary item's response, and
-- so the 2 Mio limit of a receipt (1 000-operation copies, estimate-large-v3-scale.test.sql), keep their size.
CREATE OR REPLACE FUNCTION public.commit_estimate_batch(p_version_id uuid, p_operation_key uuid, p_expected_updated_at timestamp with time zone, p_draft_lock_session_id uuid, p_operations jsonb, p_created_ids jsonb, p_item_updates jsonb, p_version_patch jsonb, p_calculation_context jsonb, p_expected_aid_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ctx jsonb; actor uuid; target_tenant uuid; project_owner uuid;
  v public.estimate_versions%rowtype; lease public.draft_locks%rowtype; item public.estimate_items%rowtype; old_item public.estimate_items%rowtype;
  saved private.estimate_batch_receipts%rowtype; operations jsonb; canonical jsonb; raw_context jsonb; aid_policy jsonb;
  op jsonb; data jsonb; normalized jsonb; projected jsonb; results jsonb:='[]'; response jsonb; operation_index integer:=-1;
  item_id uuid; target_parent uuid; actual_ids uuid[]; supplied_ids uuid[]; affected_ids uuid[]:='{}'; deleted_ids uuid[]; role_ids uuid[];
  depth integer; parent_depth integer; hierarchy_invalid boolean; position_value integer; create_count integer; changed integer; event_time timestamptz;
  has_supply boolean; has_labor boolean; failure_code text; failure_message text; operation_stage boolean:=true;
  is_v3 boolean; previous_v3_writer text;
  created_by_index jsonb; projection_by_id jsonb; created_entry jsonb;
  result_list jsonb[]:='{}'; create_only boolean; previous_creation_contract text;
  -- Lot 3.1: set-based creates.
  set_based boolean; created_items public.estimate_items[]; created_sections jsonb; reference_ids uuid[]; written_count integer;
begin
  ctx:=private.estimate_batch_context(p_version_id,true);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  if p_operation_key is null then perform private.estimate_batch_error('OPERATION_KEY_REQUIRED'); end if;
  if p_expected_updated_at is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  operations:=private.canonical_estimate_batch_operations(p_operations);
  canonical:=jsonb_build_object('versionId',p_version_id,'actorId',actor,'expectedUpdatedAt',p_expected_updated_at,'operations',operations);
  -- A matching request waits for the in-flight transaction and resolves its
  -- receipt before stale-token, lease, status or derived-context checks.
  select * into v from public.estimate_versions where id=p_version_id for update;
  perform 1 from public.estimate_projects where id=v.project_id for share nowait;
  ctx:=private.estimate_batch_context(p_version_id,true);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  if v.tenant_id is distinct from target_tenant or v.project_id is distinct from (ctx->>'project_id')::uuid then perform private.estimate_batch_error('STALE'); end if;
  select * into saved from private.estimate_batch_receipts where version_id=p_version_id and operation_key=p_operation_key;
  if found then
    if saved.actor_id<>actor or saved.tenant_id<>target_tenant or saved.project_id<>v.project_id or saved.canonical_request is distinct from canonical then perform private.estimate_batch_error('IDEMPOTENCY_CONFLICT'); end if;
    return saved.response||jsonb_build_object('replayed',true,'current_version',jsonb_build_object('id',v.id,'updated_at',v.updated_at,'status',v.status));
  end if;
  if v.status<>'draft' or (ctx->>'is_archived')::boolean then perform private.estimate_batch_error('FORBIDDEN'); end if;
  is_v3:=v.calc_engine_version=3;
  if v.updated_at is distinct from p_expected_updated_at then perform private.estimate_batch_error('STALE'); end if;
  select * into lease from public.draft_locks where version_id=p_version_id and tenant_id=target_tenant for update nowait;
  if not found or p_draft_lock_session_id is null or lease.user_id is distinct from actor or lease.session_id is distinct from p_draft_lock_session_id or lease.expires_at<=clock_timestamp() then perform private.estimate_batch_error('LOCK_REQUIRED'); end if;
  perform id from public.estimate_items where version_id=p_version_id order by id for update nowait;
  if jsonb_typeof(p_created_ids) is distinct from 'array' or jsonb_typeof(p_item_updates) is distinct from 'array' or jsonb_typeof(p_version_patch) is distinct from 'object' or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or not(p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents']) or p_version_patch-array['total_ht_cents','total_tax_cents','total_ttc_cents','gross_ht_cents','discount_applied_cents','commercial_rounding_cents']<>'{}'::jsonb
    or (p_version_patch ?| array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) is distinct from is_v3
    or is_v3 and not(p_version_patch ?& array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_each(p_version_patch) x where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$' or x.value::text::numeric>2147483647) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  select count(*) into create_count from jsonb_array_elements(operations) x where x->>'op'='create';
  if jsonb_array_length(p_created_ids)<>create_count or exists(select 1 from jsonb_array_elements(p_created_ids) x where jsonb_typeof(x)<>'object' or not(x?&array['index','id']) or x-array['index','id','source_metadata']<>'{}'::jsonb or jsonb_typeof(x->'source_metadata')<>'object' or jsonb_typeof(x->'id')<>'string' or jsonb_typeof(x->'index')<>'number' or x->>'index'!~'^[0-9]+$') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_created_ids) x where (x->>'index')::numeric>999 or operations->(x->>'index')::integer->>'op' is distinct from 'create')
    or (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_created_ids) x)<>create_count
    or (select count(distinct (x->>'index')::integer) from jsonb_array_elements(p_created_ids) x)<>create_count
    or exists(select 1 from jsonb_array_elements(p_created_ids) x join public.estimate_items i on i.id=(x->>'id')::uuid) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates) x where jsonb_typeof(x)<>'object' or not(x?&array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']) or x-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb or jsonb_typeof(x->'id')<>'string')
    or exists(select 1 from jsonb_array_elements(p_item_updates) x cross join lateral jsonb_each(x-'id') n where not(is_v3 and n.key='pu_ht_cents' and n.value='null'::jsonb) and (jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647)) then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into supplied_ids from jsonb_array_elements(p_item_updates) x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids) x) then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
  -- 2.8b: one lookup per operation instead of a scan of both arrays (quadratic over a 1 000-operation copy).
  select coalesce(jsonb_object_agg(((x->>'index')::integer)::text,x),'{}') into created_by_index from jsonb_array_elements(p_created_ids) x;
  select coalesce(jsonb_object_agg(((x->>'id')::uuid)::text,x),'{}') into projection_by_id from jsonb_array_elements(p_item_updates) x;
  -- 7. (G2) No reference of another tenant in the provenance carried by p_created_ids.
  if exists(
    with refs as (
      select r.kind,lower(r.ref)::uuid as id from jsonb_array_elements(p_created_ids) x
      cross join lateral (values ('import',x->'source_metadata'->>'import_id'),('mapping',x->'source_metadata'->>'mapping_id'),
        ('row',x->'source_metadata'->>'mapped_row_id'),('document',x->'source_metadata'->'_timax_provenance'->>'source_document_id'),
        ('document',x->'source_metadata'->'_timax_provenance'->>'sourceDocumentId')) r(kind,ref)
      where jsonb_typeof(x->'source_metadata')='object' and r.ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    select 1 from refs join public.dpgf_imports t on refs.kind='import' and t.id=refs.id where t.tenant_id is distinct from target_tenant
    union all select 1 from refs join public.dpgf_mappings t on refs.kind='mapping' and t.id=refs.id where t.tenant_id is distinct from target_tenant
    union all select 1 from refs join public.dpgf_rows_mapped t on refs.kind='row' and t.id=refs.id where t.tenant_id is distinct from target_tenant
    union all select 1 from refs join public.affaire_intake_documents t on refs.kind='document' and t.id=refs.id where t.tenant_id is distinct from target_tenant)
  then perform private.estimate_batch_error('SOURCE_METADATA_FOREIGN'); end if;
  create_only:=not exists(select 1 from jsonb_array_elements(operations) x where x->>'op'<>'create');
  select jsonb_build_object('id',id,'enabled',enabled,'value',value) into aid_policy from public.feature_flags where tenant_id=target_tenant and flag_key='ESTIMATE_ITEM_AID_REGEX';
  if coalesce(aid_policy,'null'::jsonb) is distinct from coalesce(p_expected_aid_policy,'null'::jsonb) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;

  -- Catch confirmed operation failure only around ALL writes. Subtransaction
  -- rollback restores cascades, technical revisions, audit, footer and receipt.
  begin
    previous_v3_writer:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer',true),'');
    if is_v3 then perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',p_version_id::text,true); end if;
    -- 4. Creations only: the per-line effects of the inserts are replayed in one pass after the loop (M6b contract).
    if create_only then
      previous_creation_contract:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic',true),'');
      perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic',p_version_id::text,true);
    end if;
    -- Lot 3.1: a batch of creations only that names the position and the title of every item and carries no takeoff
    -- source (the server-side copies, a paste) is written by one INSERT instead of one per operation. Each row is the
    -- record the loop below builds (same normalization, defaults, projection, line nature and source_metadata); the
    -- loop's checks run over the whole batch first (a parent is a section stored in the version or created earlier in
    -- the batch; every reference exists in the tenant, the same rows locked FOR SHARE NOWAIT); the BEFORE row triggers,
    -- constraints and foreign keys run unchanged on each row. Any refusal or error rolls this block back and the loop
    -- runs instead: it reports the same operation, code and index as before.
    set_based:=create_only and not exists(select 1 from jsonb_array_elements(operations) x
      where not(x->'data' ?& array['position','title']) or x->'data'->>'source_job_id' is not null);
    if set_based then
      begin
        select coalesce(array_agg(r.item order by r.idx),'{}') into created_items
        from (
          select o.idx,jsonb_populate_record(null::public.estimate_items,public.estimate_fo_price_origin_write_input(case when o.data->>'item_type'='line'
            then jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',v.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1)||o.normalized
              ||(coalesce(projection_by_id->(o.item_id::text),'{"pu_ht_cents":0,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb)-'id')
            else o.normalized||'{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'::jsonb end)) as item
          from (
            select e.idx,e.data,e.item_id,
              (jsonb_build_object('id',e.item_id,'tenant_id',target_tenant,'version_id',p_version_id,'parent_id',(e.data->>'parent_id')::uuid,
                'position',(e.data->>'position')::integer,'title',e.data->>'title','source_provider',coalesce(e.data->>'source_provider','manual'))||e.data)
                ||jsonb_build_object('source_provider',coalesce(e.data->>'source_provider','manual')) as normalized
            from (
              select (x.ordinality-1)::integer as idx,x.value->'data' as data,(created_by_index->((x.ordinality-1)::text)->>'id')::uuid as item_id
              from jsonb_array_elements(operations) with ordinality x
            ) e
          ) o
        ) r;
        -- The parent of each item, as the loop sees it before its insert.
        select coalesce(jsonb_object_agg(c.id::text,c.ordinality),'{}') into created_sections
        from unnest(created_items) with ordinality c where c.item_type='section';
        if exists(select 1 from unnest(created_items) with ordinality c
          where c.parent_id is not null
            and coalesce((created_sections->>(c.parent_id::text))::bigint>=c.ordinality,true)
            and not exists(select 1 from public.estimate_items p where p.id=c.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant and p.item_type='section'))
        then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        -- The references the loop checks and locks, each row once.
        select coalesce(array_agg(distinct c.category_id),'{}') into reference_ids from unnest(created_items) c where c.category_id is not null;
        if cardinality(reference_ids)>0 then
          perform 1 from public.estimate_categories c where c.id=any(reference_ids) and c.tenant_id=target_tenant and c.user_id=project_owner for share nowait;
          get diagnostics written_count=row_count;
          if written_count<>cardinality(reference_ids) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        end if;
        select coalesce(array_agg(distinct c.supply_type_id),'{}') into reference_ids from unnest(created_items) c where c.supply_type_id is not null;
        if cardinality(reference_ids)>0 then
          perform 1 from public.supply_types s where s.id=any(reference_ids) and s.tenant_id=target_tenant for share nowait;
          get diagnostics written_count=row_count;
          if written_count<>cardinality(reference_ids) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        end if;
        select coalesce(array_agg(distinct c.product_id),'{}') into reference_ids from unnest(created_items) c where c.product_id is not null;
        if cardinality(reference_ids)>0 then
          perform 1 from public.products p where p.id=any(reference_ids) and p.tenant_id=target_tenant for share nowait;
          get diagnostics written_count=row_count;
          if written_count<>cardinality(reference_ids) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        end if;
        select coalesce(array_agg(distinct c.selected_supplier_price_id),'{}') into reference_ids from unnest(created_items) c where c.selected_supplier_price_id is not null;
        if cardinality(reference_ids)>0 then
          perform 1 from public.supplier_pricebook s where s.id=any(reference_ids) and s.tenant_id=target_tenant for share nowait;
          get diagnostics written_count=row_count;
          if written_count<>cardinality(reference_ids) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        end if;
        if exists(select 1 from (select distinct r.id from unnest(created_items) c
            cross join lateral unnest(array[c.labor_role_id,c.labor_role_atelier_id,c.labor_role_chantier_id]) r(id) where r.id is not null) r
          where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner))
        then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        -- The loop's insert, one row per operation in batch order; a line without line_nature gets the loop's.
        insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,fo_price_origin,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit,source_metadata,status_reason) -- TI-682 (ajout) : status_reason
        select i.id,i.tenant_id,i.version_id,i.parent_id,i.item_type,i.position,i.title,i.description,i.aid,i.quantity,i.unit_price_ht_cents,i.tax_rate_bp,i.k_fo,i.h_mo,i.h_mo_majoration,i.k_mo,i.h_mo_atelier,i.k_mo_atelier,i.labor_role_atelier_id,i.h_mo_chantier,i.k_mo_chantier,i.labor_role_chantier_id,i.pu_ht_cents,i.labor_role_id,i.category_id,i.supply_type_id,i.product_id,i.selected_supplier_price_id,i.fo_price_origin,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents,
          case when i.item_type='line' and not(operations->(i.ordinality-1)::integer->'data' ? 'line_nature') then
            (case when f.has_labor and not f.has_supply then 'labor_only' when f.has_labor then 'supply_and_labor' else 'supply_only' end)::public.estimate_line_nature
          else i.line_nature end,
          i.source_provider,i.source_job_id,i.source_file_name,i.source_page,i.unit_code,coalesce(i.pricing_status,'priced'::public.estimate_line_pricing_status),i.h_mo_per_unit,i.h_mo_atelier_per_unit,i.h_mo_chantier_per_unit,
          coalesce(created_by_index->((i.ordinality-1)::text)->'source_metadata','{}'::jsonb),i.status_reason -- TI-682 (ajout) : i.status_reason
        from unnest(created_items) with ordinality i
        cross join lateral (select coalesce(i.unit_price_ht_cents,0)>0 or i.supply_type_id is not null or i.selected_supplier_price_id is not null as has_supply,
          coalesce(i.h_mo,0)>0 or coalesce(i.h_mo_atelier,0)>0 or coalesce(i.h_mo_chantier,0)>0 or i.labor_role_id is not null or i.labor_role_atelier_id is not null or i.labor_role_chantier_id is not null
            or coalesce(i.h_mo_per_unit,0)>0 or coalesce(i.h_mo_atelier_per_unit,0)>0 or coalesce(i.h_mo_chantier_per_unit,0)>0 as has_labor) f
        order by i.ordinality;
        get diagnostics written_count=row_count;
        if written_count<>jsonb_array_length(operations) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        select coalesce(array_agg(jsonb_build_object('index',c.ordinality-1,'op','create','status','ok','data',jsonb_build_object('item_id',c.id)) order by c.ordinality),'{}'),
          coalesce(array_agg(c.id order by c.ordinality) filter (where c.item_type='line'),'{}')
          into result_list,affected_ids
        from unnest(created_items) with ordinality c;
        operation_index:=written_count-1;
      exception when others then
        set_based:=false; operation_index:=-1; result_list:='{}'; affected_ids:='{}';
      end;
    end if;
    if not set_based then
      for op in select * from jsonb_array_elements(operations) loop
        operation_index:=operation_index+1; data:=op->'data'; item_id:=null;
        if op->>'op'='create' then
          created_entry:=created_by_index->(operation_index::text); item_id:=(created_entry->>'id')::uuid;
          target_parent:=(data->>'parent_id')::uuid;
          -- 5. The sibling scan and the ancestor walk only feed the default position and title.
          position_value:=null;
          if not(data?'position') then select coalesce(max(position),0)+1 into position_value from public.estimate_items where version_id=p_version_id and parent_id is not distinct from target_parent; end if;
          depth:=1;
          if target_parent is not null and not(data?'title') then
            with recursive ancestors as(select id,parent_id,1 as d from public.estimate_items where id=target_parent and version_id=p_version_id union all select i.id,i.parent_id,a.d+1 from public.estimate_items i join ancestors a on i.id=a.parent_id where a.d<5) select coalesce(max(d),0)+1 into depth from ancestors;
          end if;
          normalized:=jsonb_build_object('id',item_id,'tenant_id',target_tenant,'version_id',p_version_id,'parent_id',target_parent,'position',coalesce((data->>'position')::integer,position_value),'title',coalesce(data->>'title',case when data->>'item_type'='line' then 'Nouvelle ligne' else 'Nouveau '||case depth when 1 then 'lot' when 2 then 'chapitre' when 3 then 'sous-chapitre' else 'ouvrage' end end),'source_provider',coalesce(data->>'source_provider','manual'))||data;
          -- Explicit null provider still means manual; do not inject this default
          -- into the canonical request retained in the receipt.
          normalized:=normalized||jsonb_build_object('source_provider',coalesce(data->>'source_provider','manual'));
          if data->>'item_type'='line' then
            projected:=projection_by_id->(item_id::text);
            -- A later parent deletion can remove this create before the final
            -- projection. Temporary zeros satisfy storage constraints only;
            -- the exact final-ID check still rejects every surviving omission.
            if projected is null then projected:='{"pu_ht_cents":0,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb; end if;
            normalized:=jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',v.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1)||normalized||(projected-'id');
          else normalized:=normalized||'{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'; end if;
          select * into item from jsonb_populate_record(null::public.estimate_items,public.estimate_fo_price_origin_write_input(normalized));
        elsif op->>'op'='update' then
          item_id:=(op->>'id')::uuid;
          select * into old_item from public.estimate_items where id=item_id and version_id=p_version_id and tenant_id=target_tenant;
          if not found then perform private.estimate_batch_error('NOT_FOUND'); end if;
          if old_item.item_type='section' and data-array['parent_id','position','title','aid']<>'{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          select * into item from jsonb_populate_record(old_item,data-array['pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']);
        elsif op->>'op'='delete' then
          item_id:=(op->>'id')::uuid;
          if not exists(select 1 from public.estimate_items where id=item_id and version_id=p_version_id and tenant_id=target_tenant) then perform private.estimate_batch_error('NOT_FOUND'); end if;
          with recursive closure as(select id from public.estimate_items where id=item_id and version_id=p_version_id union select i.id from public.estimate_items i join closure c on i.parent_id=c.id where i.version_id=p_version_id) select array_agg(id order by id) into deleted_ids from closure;
          delete from public.estimate_items where id=item_id and version_id=p_version_id;
          result_list:=array_append(result_list,jsonb_build_object('index',operation_index,'op','delete','status','ok','data',jsonb_build_object('deleted_id',item_id,'deleted_ids',deleted_ids)));
          continue;
        else
          target_parent:=(data->>'parent_id')::uuid;
          if target_parent is not null and not exists(select 1 from public.estimate_items where id=target_parent and version_id=p_version_id and tenant_id=target_tenant and item_type='section') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and tenant_id=target_tenant and parent_id is not distinct from target_parent;
          select array_agg((x#>>'{}')::uuid order by (x#>>'{}')::uuid) into deleted_ids from jsonb_array_elements(data->'ordered_ids') x;
          if actual_ids is distinct from deleted_ids then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          with ordered as(select (x.value#>>'{}')::uuid as id,x.ordinality::integer as pos from jsonb_array_elements(data->'ordered_ids') with ordinality x)
            update public.estimate_items i set position=-o.pos from ordered o where i.id=o.id and i.version_id=p_version_id;
          with ordered as(select (x.value#>>'{}')::uuid as id,x.ordinality::integer as pos from jsonb_array_elements(data->'ordered_ids') with ordinality x)
            update public.estimate_items i set position=o.pos from ordered o where i.id=o.id and i.version_id=p_version_id;
          get diagnostics changed=row_count;
          result_list:=array_append(result_list,jsonb_build_object('index',operation_index,'op','reorder','status','ok','data',jsonb_build_object('parent_id',target_parent,'ordered_ids',data->'ordered_ids','updated_count',changed)));
          continue;
        end if;

        if item.parent_id is not null and not exists(select 1 from public.estimate_items p where p.id=item.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant and p.item_type='section') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if op->>'op'='update' and item.item_type='section' and item.parent_id is distinct from old_item.parent_id then
          -- The generic BEFORE trigger validates the moved node, not its retained
          -- descendants. Validate both trees before UPDATE while all version items
          -- are locked. Paths and the version depth bound stop corrupt/cyclic
          -- inputs explicitly; no timeout is used as hierarchy validation.
          with recursive parents as (
            select p.id,p.parent_id,p.item_type,1 as d,array[p.id] as path,false as cycle
            from public.estimate_items p where p.id=item.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant
            union all
            select p.id,p.parent_id,p.item_type,a.d+1,a.path||p.id,p.id=any(a.path)
            from public.estimate_items p join parents a on p.id=a.parent_id
            where p.version_id=p_version_id and p.tenant_id=target_tenant and not a.cycle and a.d<=coalesce(v.max_section_depth,3)
          ) select coalesce(max(d),0),coalesce(bool_or(cycle or d>coalesce(v.max_section_depth,3) or item_type<>'section'),false)
            into parent_depth,hierarchy_invalid from parents;
          if hierarchy_invalid then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          with recursive subtree as (
            select p.id,p.item_type,0 as d,array[p.id] as path,false as cycle
            from public.estimate_items p where p.id=item.id and p.version_id=p_version_id and p.tenant_id=target_tenant
            union all
            select c.id,c.item_type,s.d+1,s.path||c.id,c.id=any(s.path)
            from public.estimate_items c join subtree s on c.parent_id=s.id
            where c.version_id=p_version_id and c.tenant_id=target_tenant and not s.cycle and s.d<=coalesce(v.max_section_depth,3)
          ) select coalesce(bool_or(cycle or id=item.parent_id
            or (item_type='section' and parent_depth+1+d>coalesce(v.max_section_depth,3))
            or (item_type='line' and parent_depth+d>coalesce(v.max_section_depth,3))),false)
            into hierarchy_invalid from subtree;
          if hierarchy_invalid then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        end if;
        if item.source_job_id is not null then
          perform 1 from public.takeoff_jobs j where j.id=item.source_job_id and j.tenant_id=target_tenant for share nowait;
          if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          -- Version duplication retains the original source_job_id. UPDATE never
          -- accepts a new source ID. A new attachment needs the target job or an
          -- explicit, locked carry-over link, not just another job in the tenant.
          if op->>'op'='create' and not exists(select 1 from public.takeoff_jobs j where j.id=item.source_job_id and j.estimate_version_id=p_version_id) then
            perform 1 from public.takeoff_version_links l join public.takeoff_jobs j on j.id=l.takeoff_job_id and j.tenant_id=l.tenant_id and j.estimate_version_id=l.source_version_id
            where l.tenant_id=target_tenant and l.takeoff_job_id=item.source_job_id and l.target_version_id=p_version_id for share of l nowait;
            if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          end if;
        end if;
        -- Rows behind retained references are stabilized too: a concurrent scope
        -- move cannot pass the validation and commit before this item transaction.
        if item.category_id is not null then perform 1 from public.estimate_categories c where c.id=item.category_id and c.tenant_id=target_tenant and c.user_id=project_owner for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
        if item.supply_type_id is not null then perform 1 from public.supply_types s where s.id=item.supply_type_id and s.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
        if item.product_id is not null then perform 1 from public.products p where p.id=item.product_id and p.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
        if item.selected_supplier_price_id is not null then perform 1 from public.supplier_pricebook s where s.id=item.selected_supplier_price_id and s.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
        if exists(select 1 from unnest(array[item.labor_role_id,item.labor_role_atelier_id,item.labor_role_chantier_id]) r(id) where r.id is not null and not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if item.item_type='line' then
          has_supply:=coalesce(item.unit_price_ht_cents,0)>0 or item.supply_type_id is not null or item.selected_supplier_price_id is not null;
          has_labor:=coalesce(item.h_mo,0)>0 or coalesce(item.h_mo_atelier,0)>0 or coalesce(item.h_mo_chantier,0)>0 or item.labor_role_id is not null or item.labor_role_atelier_id is not null or item.labor_role_chantier_id is not null
            or coalesce(item.h_mo_per_unit,0)>0 or coalesce(item.h_mo_atelier_per_unit,0)>0 or coalesce(item.h_mo_chantier_per_unit,0)>0;
          if not(data?'line_nature') then
            if op->>'op'='create' then item.line_nature:=(case when has_labor and not has_supply then 'labor_only' when has_labor then 'supply_and_labor' else 'supply_only' end)::public.estimate_line_nature;
            elsif old_item.line_nature='supply_only' and data?|array['h_mo','h_mo_atelier','h_mo_chantier','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'] and has_labor or old_item.line_nature='labor_only' and data?|array['unit_price_ht_cents','supply_type_id','selected_supplier_price_id'] and has_supply then item.line_nature:='supply_and_labor'; end if;
          end if;
          affected_ids:=array_append(affected_ids,item.id);
        end if;
        if op->>'op'='create' then
          insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,fo_price_origin,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit,source_metadata,status_reason) -- TI-682 (ajout) : status_reason
          values(item.id,item.tenant_id,item.version_id,item.parent_id,item.item_type,item.position,item.title,item.description,item.aid,item.quantity,item.unit_price_ht_cents,item.tax_rate_bp,item.k_fo,item.h_mo,item.h_mo_majoration,item.k_mo,item.h_mo_atelier,item.k_mo_atelier,item.labor_role_atelier_id,item.h_mo_chantier,item.k_mo_chantier,item.labor_role_chantier_id,item.pu_ht_cents,item.labor_role_id,item.category_id,item.supply_type_id,item.product_id,item.selected_supplier_price_id,item.fo_price_origin,item.line_total_ht_cents,item.line_tax_cents,item.line_total_ttc_cents,item.line_nature,item.source_provider,item.source_job_id,item.source_file_name,item.source_page,item.unit_code,coalesce(item.pricing_status,'priced'::public.estimate_line_pricing_status),item.h_mo_per_unit,item.h_mo_atelier_per_unit,item.h_mo_chantier_per_unit,coalesce(created_entry->'source_metadata','{}'::jsonb),item.status_reason); -- TI-682 (ajout) : item.status_reason
        else
          update public.estimate_items set parent_id=item.parent_id,position=item.position,title=item.title,description=item.description,aid=item.aid,quantity=item.quantity,unit_price_ht_cents=item.unit_price_ht_cents,tax_rate_bp=item.tax_rate_bp,k_fo=item.k_fo,h_mo=item.h_mo,h_mo_majoration=item.h_mo_majoration,k_mo=item.k_mo,h_mo_atelier=item.h_mo_atelier,k_mo_atelier=item.k_mo_atelier,labor_role_atelier_id=item.labor_role_atelier_id,h_mo_chantier=item.h_mo_chantier,k_mo_chantier=item.k_mo_chantier,labor_role_chantier_id=item.labor_role_chantier_id,labor_role_id=item.labor_role_id,category_id=item.category_id,supply_type_id=item.supply_type_id,product_id=item.product_id,selected_supplier_price_id=item.selected_supplier_price_id,fo_price_origin=item.fo_price_origin,line_nature=item.line_nature,unit_code=item.unit_code,pricing_status=item.pricing_status,h_mo_per_unit=item.h_mo_per_unit,h_mo_atelier_per_unit=item.h_mo_atelier_per_unit,h_mo_chantier_per_unit=item.h_mo_chantier_per_unit,status_reason=item.status_reason where id=item.id and version_id=p_version_id; -- TI-682 (ajout) : status_reason
        end if;
        result_list:=array_append(result_list,jsonb_build_object('index',operation_index,'op',op->>'op','status','ok','data',jsonb_build_object('item_id',item.id)));
      end loop;
    end if;
    results:=to_jsonb(result_list);
    operation_stage:=false;
    if create_only then
      perform public.estimate_creation_replay_item_effects_for_writer(p_version_id,
        array(select (x->>'id')::uuid from jsonb_array_elements(p_created_ids) x order by (x->>'index')::integer));
      perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic',previous_creation_contract,true);
    end if;
    select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and item_type='line' and (private.calc_engine_freezes_snapshot(v.calc_engine_version) or id=any(affected_ids));
    if supplied_ids is distinct from actual_ids then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
    select coalesce(array_agg(distinct r.id order by r.id),'{}') into role_ids from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(id) where i.version_id=p_version_id and i.item_type='line' and r.id is not null;
    if private.calc_engine_freezes_snapshot(v.calc_engine_version) and exists(select 1 from unnest(role_ids) r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
    select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_owner),'[]'),
      'margin_tiers',case when v.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
      'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
    if raw_context is distinct from p_calculation_context then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
    select * into v from public.estimate_versions where id=p_version_id;
    -- 2.8b: a v3 rewrites only the lines whose projection differs from the stored amounts; every other line
    -- keeps them, and private.estimate_v3_assert_draft below still checks every line and the footer (D12).
    perform public.bulk_update_estimate_items(p_version_id,case when not is_v3 then p_item_updates else coalesce((
      select jsonb_agg(u.value order by u.ordinality) from jsonb_array_elements(p_item_updates) with ordinality u
      join public.estimate_items i on i.id=(u.value->>'id')::uuid and i.version_id=p_version_id
      where (i.pu_ht_cents,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents) is distinct from
        ((u.value->>'pu_ht_cents')::integer,(u.value->>'line_total_ht_cents')::integer,(u.value->>'line_tax_cents')::integer,(u.value->>'line_total_ttc_cents')::integer)),'[]'::jsonb) end,
      case when is_v3 then null else p_version_patch end,v.updated_at);
    if is_v3 then
      update public.estimate_versions set total_ht_cents=(p_version_patch->>'total_ht_cents')::integer,total_tax_cents=(p_version_patch->>'total_tax_cents')::integer,total_ttc_cents=(p_version_patch->>'total_ttc_cents')::integer,
        gross_ht_cents=(p_version_patch->>'gross_ht_cents')::integer,discount_applied_cents=(p_version_patch->>'discount_applied_cents')::integer,commercial_rounding_cents=(p_version_patch->>'commercial_rounding_cents')::integer
      where id=p_version_id and tenant_id=target_tenant;
      perform private.estimate_v3_assert_draft(p_version_id);
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',previous_v3_writer,true);
    end if;
    select * into v from public.estimate_versions where id=p_version_id;
    select coalesce(jsonb_agg(case when x->>'op' in('create','update') then jsonb_set(x,'{data}',case when i.id is null then jsonb_build_object('item',null,'deleted_in_batch',true,'deleted_item_id',x->'data'->'item_id') else jsonb_build_object('item',(case when created_by_index->(x->>'index') ? 'source_metadata' then to_jsonb(i)-'source_metadata' else to_jsonb(i) end)-array_remove(array[case when not i.was_not_priced then 'was_not_priced' end,case when i.status_reason is null then 'status_reason' end],null)) end) else x end order by (x->>'index')::integer),'[]') into results -- TI-682 (ajout) : was_not_priced et status_reason absents à leur valeur par défaut (reçu de 2 Mio inchangé)
    from jsonb_array_elements(results) x left join public.estimate_items i on i.id=(x->'data'->>'item_id')::uuid and i.version_id=p_version_id;
    perform public.log_estimate_batch_audit(p_version_id,operations);
    event_time:=clock_timestamp();
    response:=jsonb_build_object('committed',true,'results',results,'version',jsonb_build_object('id',v.id,'updated_at',v.updated_at),'totals',jsonb_build_object('total_ht_cents',v.total_ht_cents,'total_tax_cents',v.total_tax_cents,'total_ttc_cents',v.total_ttc_cents),
      'receipt',jsonb_build_object('operation_key',p_operation_key,'actor_id',actor,'version_id',p_version_id,'expected_updated_at',p_expected_updated_at,'operations',operations,'committed_at',event_time));
    -- 6. A receipt over 2 Mio is refused by name (nothing written), no longer as a generic invalid input.
    if octet_length(response::text)>2097152 then perform private.estimate_batch_error('RECEIPT_TOO_LARGE'); end if;
    insert into private.estimate_batch_receipts(version_id,operation_key,tenant_id,project_id,actor_id,canonical_request,response,committed_at) values(p_version_id,p_operation_key,target_tenant,v.project_id,actor,canonical,response,event_time);
    return response||jsonb_build_object('replayed',false,'current_version',jsonb_build_object('id',v.id,'updated_at',v.updated_at,'status',v.status));
  exception when others then
    get stacked diagnostics failure_code=returned_sqlstate,failure_message=message_text;
    results:=to_jsonb(result_list);
    if failure_message='ESTIMATE_V3_PROJECTION_MISMATCH' then failure_message:='ESTIMATE_BATCH_PROJECTION_MISMATCH'; end if;
    if failure_message not in('ESTIMATE_BATCH_INVALID_INPUT','ESTIMATE_BATCH_RECEIPT_TOO_LARGE','ESTIMATE_BATCH_NOT_FOUND','ESTIMATE_BATCH_PROJECTION_MISMATCH','ESTIMATE_BATCH_CONTEXT_CHANGED','ESTIMATE_BATCH_STALE','ESTIMATE_BATCH_FORBIDDEN','ESTIMATE_BATCH_LOCK_REQUIRED') then
      failure_message:=case when failure_code in('40001','40P01','55P03') then 'ESTIMATE_BATCH_STALE' else 'ESTIMATE_BATCH_INVALID_INPUT' end;
    end if;
    -- Context/projection/finalization failures have no invented operation index.
    if not operation_stage then raise exception using errcode=case when failure_message like '%CONTEXT_CHANGED' or failure_message like '%STALE' then '40001' else '22023' end,message=failure_message; end if;
    select coalesce(jsonb_agg(jsonb_build_object('index',x->'index','op',x->'op','status','ok','data',jsonb_build_object('rolled_back',true)) order by (x->>'index')::integer),'[]') into results from jsonb_array_elements(results) x;
    results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op',op->>'op','status','error','code',failure_message,'message','Le lot a été annulé.'));
    return jsonb_build_object('committed',false,'results',results,'version',jsonb_build_object('id',p_version_id,'updated_at',p_expected_updated_at));
  end;
exception when lock_not_available or deadlock_detected then perform private.estimate_batch_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.estimate_batch_error('INVALID_INPUT'); return null;
end $function$;


-- Latest owning definition: 20261109183432_estimate_fo_price_origin.sql. Added only was_not_priced and status_reason to the copy (TI-682).
CREATE OR REPLACE FUNCTION public.duplicate_estimate_version_without_product_id(source_version_id uuid, as_variant boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_user_id uuid := (select auth.uid());
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
  variant_parent_id uuid := null;
  next_variant_index integer := 0;
  next_variant_label text := null;
  item_id_map jsonb := '{}'::jsonb;
  previous_insert_contract text;
  source_is_v3 boolean;
  previous_v3_writer text;
begin
  if actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'AUTHENTICATION_REQUIRED';
  end if;

  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
    and p.tenant_id = v.tenant_id
  join public.tenants tenant
    on tenant.id = p.tenant_id
    and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = p.tenant_id
    and membership.user_id = actor_user_id
  where v.id = duplicate_estimate_version_without_product_id.source_version_id
    and not p.is_archived
    and membership.role in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
    and (
      p.user_id = actor_user_id
      or membership.role = 'admin'::public.tenant_role
    )
  for update of p, v;

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  if coalesce(as_variant, false) then
    variant_parent_id := duplicate_estimate_version_without_product_id.source_version_id;

    loop
      next_variant_index := next_variant_index + 1;
      next_variant_label := public.estimate_variant_label_from_index(next_variant_index);

      exit when not exists (
        select 1
        from public.estimate_versions existing_variant
        where existing_variant.parent_version_id = variant_parent_id
          and existing_variant.variant_label = next_variant_label
      );
    end loop;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  source_is_v3 := source_version.calc_engine_version = 3;
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    case when source_is_v3 then 'duplicate_source_v3' else 'duplicate_source' end,
    true
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    exclusions,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    parent_version_id,
    variant_label,
    max_section_depth,
    sale_coefficient_fo,
    sale_coefficient_mo,
    gross_ht_cents,
    discount_applied_cents,
    commercial_rounding_cents
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.exclusions,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_amount_cents,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.calc_engine_version,
    source_version.contractor_role,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents,
    variant_parent_id,
    next_variant_label,
    source_version.max_section_depth,
    source_version.sale_coefficient_fo,
    source_version.sale_coefficient_mo,
    source_version.gross_ht_cents,
    source_version.discount_applied_cents,
    source_version.commercial_rounding_cents
  );

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  if source_is_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      new_version_id::text,
      true
    );
  end if;

  if source_is_v3 then
    -- D13 : les répartitions exactes v3 (remise, TVA) départagent leurs ex aequo par identifiant de ligne
    -- croissant. Les identifiants neufs suivent donc l'ordre des identifiants source (le k-ième plus petit
    -- source reçoit le k-ième plus petit neuf) : les montants copiés restent ceux que le moteur calcule
    -- sur la copie, et ni son gel ni son lot suivant ne déplacent un centime d'une ligne non touchée.
    select coalesce(
      jsonb_object_agg(source_ids.id::text, fresh_ids.id::text),
      '{}'::jsonb
    )
      into item_id_map
    from (
      select item.id, row_number() over (order by item.id) as id_rank
      from public.estimate_items as item
      where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
        and item.tenant_id = source_version.tenant_id
    ) as source_ids
    join (
      select fresh.id, row_number() over (order by fresh.id) as id_rank
      from (
        select gen_random_uuid() as id
        from public.estimate_items as item
        where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
          and item.tenant_id = source_version.tenant_id
      ) as fresh
    ) as fresh_ids on fresh_ids.id_rank = source_ids.id_rank;
  else
    select coalesce(
      jsonb_object_agg(item.id::text, gen_random_uuid()::text),
      '{}'::jsonb
    )
      into item_id_map
    from public.estimate_items as item
    where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
      and item.tenant_id = source_version.tenant_id;
  end if;

  with recursive source_item_hierarchy as (
    select
      root.id,
      root.parent_id,
      0 as depth
    from public.estimate_items root
    where root.version_id = duplicate_estimate_version_without_product_id.source_version_id
      and root.parent_id is null

    union all

    select
      child.id,
      child.parent_id,
      parent.depth + 1
    from public.estimate_items child
    join source_item_hierarchy parent on parent.id = child.parent_id
    where child.version_id = duplicate_estimate_version_without_product_id.source_version_id
  )
  insert into public.estimate_items (
    id,
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    aid,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    fo_provision, -- TI-534 (ajout) : la copie garde la provision de chaque ligne
    h_mo,
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    selected_supplier_price_id,fo_price_origin,
    source_provider,
    source_job_id,
    source_file_name,
    source_page,
    source_metadata,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents,
    unit_code,
    pricing_status,
    h_mo_per_unit,
    h_mo_atelier_per_unit,
    h_mo_chantier_per_unit,
    product_id,
    was_not_priced, -- TI-682 (ajout) : la copie garde « a été Non chiffrée »
    status_reason -- TI-682 (ajout) : et le motif interne
  )
  select
    (item_id_map->>hierarchy.id::text)::uuid,
    source_version.tenant_id,
    new_version_id,
    (item_id_map->>src.parent_id::text)::uuid,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.aid,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.fo_provision, -- TI-534 (ajout)
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.selected_supplier_price_id,src.fo_price_origin,
    src.source_provider,
    src.source_job_id,
    src.source_file_name,
    src.source_page,
    coalesce(src.source_metadata, '{}'::jsonb),
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents,
    src.unit_code,
    src.pricing_status,
    src.h_mo_per_unit,
    src.h_mo_atelier_per_unit,
    src.h_mo_chantier_per_unit,
    case when source_is_v3 then src.product_id end,
    src.was_not_priced, -- TI-682 (ajout)
    src.status_reason -- TI-682 (ajout)
  from source_item_hierarchy hierarchy
  join public.estimate_items src on src.id = hierarchy.id
  order by hierarchy.depth asc, src.position asc, src.id asc;

  if source_is_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      previous_v3_writer,
      true
    );
  end if;

  with carry_over_takeoff_jobs as materialized (
    select
      job.id as takeoff_job_id,
      job.estimate_version_id as provenance_source_version_id
    from public.takeoff_jobs job
    where job.tenant_id = source_version.tenant_id
      and (
        job.estimate_version_id = duplicate_estimate_version_without_product_id.source_version_id
        or exists (
          select 1
          from public.takeoff_version_links inherited_link
          where inherited_link.tenant_id = source_version.tenant_id
            and inherited_link.takeoff_job_id = job.id
            and inherited_link.target_version_id =
              duplicate_estimate_version_without_product_id.source_version_id
        )
        or exists (
          select 1
          from public.takeoff_dpgf_review_decisions decision
          where decision.tenant_id = source_version.tenant_id
            and decision.takeoff_job_id = job.id
            and decision.version_id =
              duplicate_estimate_version_without_product_id.source_version_id
        )
      )
    order by job.id
    for share of job
  )
  insert into public.takeoff_version_links (
    tenant_id,
    takeoff_job_id,
    source_version_id,
    target_version_id,
    linked_at,
    linked_by
  )
  select
    source_version.tenant_id,
    candidate.takeoff_job_id,
    candidate.provenance_source_version_id,
    new_version_id,
    now(),
    null
  from carry_over_takeoff_jobs candidate
  on conflict (takeoff_job_id, target_version_id) do nothing;

  insert into public.takeoff_dpgf_review_decisions (
    id,
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    review_reference,
    line_label,
    line_position,
    source_file_name,
    source_page,
    carried_over_from_version_id,
    carried_over_at,
    decision,
    reason,
    decided_at,
    updated_at,
    decided_by,
    quantity_snapshot
  )
  select
    gen_random_uuid(),
    src.tenant_id,
    new_version_id,
    src.takeoff_job_id,
    (item_id_map->>src.estimate_item_id::text)::uuid,
    src.review_reference,
    src.line_label,
    src.line_position,
    src.source_file_name,
    src.source_page,
    duplicate_estimate_version_without_product_id.source_version_id,
    now(),
    src.decision,
    src.reason,
    src.decided_at,
    src.updated_at,
    src.decided_by,
    src.quantity_snapshot
  from public.takeoff_dpgf_review_decisions src
  where src.version_id = duplicate_estimate_version_without_product_id.source_version_id;

  return new_version_id;
end;
$function$
;


commit;

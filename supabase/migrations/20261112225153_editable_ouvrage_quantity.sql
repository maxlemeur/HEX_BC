begin;
-- TI-718: retain the established materialized tree and its provenance. Only leaves
-- enter the pinned engine; an ouvrage's quantity is editable intent on its boundary.
-- Called solely inside commit_estimate_batch, after its actor, lock and token gates.
create function private.resize_estimate_ouvrage(p_version_id uuid, p_item_id uuid, p_quantity numeric)
returns uuid[] language plpgsql set search_path='' as $$
declare
  root public.estimate_items; node public.estimate_items; fields text[]; field text;
  next_quantity numeric; value numeric; base numeric; applied numeric;
  basis jsonb; saved jsonb; old_basis jsonb; patch jsonb; cursor_node jsonb; item_map jsonb;
  before_factor numeric; after_factor numeric; cursor_id text; visited text[];
  affected uuid[] := '{}'; is_v3 boolean;
begin
  select * into root from public.estimate_items where id=p_item_id and version_id=p_version_id;
  if not found or root.item_type<>'section' or not (root.source_metadata @> '{"kit_metier":true}'::jsonb)
    or p_quantity is null or p_quantity<0 or p_quantity>=1000000000 or p_quantity::text in ('NaN','Infinity','-Infinity') then
    perform private.estimate_batch_error('INVALID_INPUT');
  end if;
  next_quantity := round(p_quantity,3);
  if next_quantity>=1000000000 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  select jsonb_object_agg(id,to_jsonb(i)) into item_map from public.estimate_items i where version_id=p_version_id;
  select calc_engine_version=3 into is_v3 from public.estimate_versions where id=p_version_id;
  fields := case when is_v3 then array['quantity'] else array['quantity','h_mo','h_mo_atelier','h_mo_chantier'] end;
  for node in with recursive tree as (
    select id from public.estimate_items where id=root.id and version_id=p_version_id
    union
    select i.id from public.estimate_items i join tree t on i.parent_id=t.id where i.version_id=p_version_id
  ) select i.* from public.estimate_items i join tree t on i.id=t.id where i.item_type='line' loop
    before_factor:=1; after_factor:=1; cursor_id:=node.parent_id::text; visited:=array[node.id::text];
    while cursor_id is not null loop
      if cursor_id=any(visited) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      visited:=array_append(visited,cursor_id); cursor_node:=item_map->cursor_id;
      if cursor_node is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if cursor_node->'source_metadata' @> '{"kit_metier":true}'::jsonb then
        value:=coalesce((cursor_node->'source_metadata'->>'ouvrage_quantity')::numeric,1);
        before_factor:=before_factor*value;
        after_factor:=after_factor*(case when cursor_id=p_item_id::text then next_quantity else value end);
      end if;
      cursor_id:=cursor_node->>'parent_id';
    end loop;
    patch:='{}'; old_basis:=node.source_metadata->'ouvrage_composition'; basis:=coalesce(old_basis,'{}'::jsonb);
    foreach field in array fields loop
      value := (to_jsonb(node)->>field)::numeric;
      if value is null then continue; end if;
      saved:=old_basis->field;
      base:=case when (saved->>'applied')::numeric=value and (saved->>'factor')::numeric=before_factor then (saved->>'base')::numeric else value/coalesce(nullif(before_factor,0),1) end;
      applied:=round(base*after_factor,3);
      if applied>=1000000000 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      basis:=basis||jsonb_build_object(field,jsonb_build_object('base',base,'applied',applied,'factor',after_factor));
      patch:=patch||jsonb_build_object(field,applied);
    end loop;
    select * into node from jsonb_populate_record(node,patch);
    if is_v3 then
      update public.estimate_items set quantity=node.quantity,source_metadata=node.source_metadata||jsonb_build_object('ouvrage_composition',basis) where id=node.id and version_id=p_version_id;
    else
      update public.estimate_items set quantity=node.quantity,h_mo=node.h_mo,h_mo_atelier=node.h_mo_atelier,h_mo_chantier=node.h_mo_chantier,source_metadata=node.source_metadata||jsonb_build_object('ouvrage_composition',basis) where id=node.id and version_id=p_version_id;
    end if;
    affected:=array_append(affected,node.id);
  end loop;
  update public.estimate_items set source_metadata=source_metadata||jsonb_build_object('ouvrage_quantity',next_quantity) where id=root.id and version_id=p_version_id;
  return affected;
end $$;
revoke all on function private.resize_estimate_ouvrage(uuid,uuid,numeric) from public,anon,authenticated,service_role;

-- Extend the guarded batch intent, without accepting arbitrary provenance writes.
do $patch$
declare definition text; previous text;
begin
  select pg_get_functiondef('private.canonical_estimate_batch_operations(jsonb)'::regprocedure) into definition;
  previous := definition;
  definition := replace(definition,'else allowed:=common_keys||line_keys||money_keys; end if;',
    'else allowed:=common_keys||line_keys||money_keys||array[''assembly_quantity'']; end if;');
  if definition=previous then raise exception 'TI718_CANONICAL_ANCHOR'; end if;
  execute definition;
  select pg_get_functiondef('public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  previous := definition;
  definition := replace(definition,
    $old$select * into old_item from public.estimate_items$old$,
    $new$if data ? 'assembly_quantity' then
          affected_ids:=affected_ids||private.resize_estimate_ouvrage(p_version_id,item_id,(data->>'assembly_quantity')::numeric);
          data:=data-'assembly_quantity';
        end if;
        select * into old_item from public.estimate_items$new$);
  if definition=previous then raise exception 'TI718_COMMIT_ANCHOR'; end if;
  execute definition;
end $patch$;

-- An ouvrage is a priced aggregate, not a chapter: retain parent-type and cycle
-- validation while counting only actual chapters against max_section_depth.
create or replace function public.validate_estimate_item_hierarchy_depth()
returns trigger language plpgsql set search_path='' as $$
declare target_max_depth integer; chapter_depth integer; parent_count integer; invalid boolean;
begin
  if tg_op='INSERT' and new.version_id::text=coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic',true),'') then return new; end if;
  if tg_op='UPDATE' and old.parent_id is not distinct from new.parent_id and old.item_type is not distinct from new.item_type and old.version_id is not distinct from new.version_id then return new; end if;
  select coalesce(max_section_depth,3) into target_max_depth from public.estimate_versions where id=new.version_id;
  if target_max_depth is null then raise exception 'version_id invalide pour estimate_items'; end if;
  with recursive parents as (
    select i.id,i.parent_id,i.item_type,i.source_metadata,array[i.id] as path,false as cycle
    from public.estimate_items i where i.id=new.parent_id and i.version_id=new.version_id
    union all
    select i.id,i.parent_id,i.item_type,i.source_metadata,p.path||i.id,i.id=any(p.path)
    from public.estimate_items i join parents p on i.id=p.parent_id
    where i.version_id=new.version_id and not p.cycle
  ) select count(*),count(*) filter(where not coalesce(source_metadata @> '{"kit_metier":true}'::jsonb,false)),
    coalesce(bool_or(cycle or id=new.id or item_type<>'section'),false)
    into parent_count,chapter_depth,invalid from parents;
  if new.parent_id is not null and parent_count=0 then raise exception 'parent_id invalide pour estimate_items'; end if;
  if parent_count-chapter_depth+(case when new.item_type='section' and new.source_metadata @> '{"kit_metier":true}'::jsonb then 1 else 0 end)>3 and parent_count>(case when new.item_type='section' then 3 else 4 end) then raise exception 'Un ouvrage est limité à trois niveaux de composition.'; end if;
  if invalid then raise exception 'Le parent doit etre une section.'; end if;
  if new.item_type='section' then
    if chapter_depth+(case when new.source_metadata @> '{"kit_metier":true}'::jsonb then 0 else 1 end)>target_max_depth then
      raise exception 'Profondeur de section depassee (max %).',target_max_depth;
    end if;
  else
    if new.parent_id is null then raise exception 'Une ligne doit etre rattachee a une section.'; end if;
    if chapter_depth>target_max_depth then raise exception 'Une ligne ne peut pas etre rattachee au-dela du niveau %.',target_max_depth; end if;
  end if;
  -- Moving a whole subtree must validate every descendant at its prospective
  -- depth. Existing shallow four-kit trees remain readable but cannot be moved
  -- into an unsupported deeper shape.
  if tg_op='UPDATE' and new.item_type='section' and old.parent_id is distinct from new.parent_id then
    with recursive prospective as (
      select new.id as id,new.item_type as item_type,parent_count as depth,
        chapter_depth+(case when coalesce(new.source_metadata @> '{"kit_metier":true}'::jsonb,false) then 0 else 1 end) as chapters,
        parent_count-chapter_depth+(case when new.source_metadata @> '{"kit_metier":true}'::jsonb then 1 else 0 end) as ouvrages,
        array[new.id] as path,false as cycle
      union all
      select i.id,i.item_type,p.depth+1,
        p.chapters+(case when i.item_type='section' and not coalesce(i.source_metadata @> '{"kit_metier":true}'::jsonb,false) then 1 else 0 end),
        p.ouvrages+(case when i.item_type='section' and i.source_metadata @> '{"kit_metier":true}'::jsonb then 1 else 0 end),
        p.path||i.id,i.id=any(p.path)
      from public.estimate_items i join prospective p on i.parent_id=p.id
      where i.version_id=new.version_id and not p.cycle
    ) select coalesce(bool_or(cycle or chapters>target_max_depth or
      (ouvrages>3 and depth>(case when item_type='section' then 3 else 4 end))),false) into invalid from prospective;
    if invalid then raise exception 'Le déplacement dépasse la profondeur autorisée des chapitres ou ouvrages.'; end if;
  end if;
  return new;
end $$;

-- Keep the actual library unit on each new ouvrage, including nested ones.
do $unit$
declare definition text; previous text;
begin
  select pg_get_functiondef('public.materialize_estimate_assembly_tree(uuid,uuid,uuid,integer,numeric,integer)'::regprocedure) into definition;
  previous:=definition;
  definition:=replace(definition,$old$jsonb_build_object('kit_metier',true,'assembly_id',source_assembly.id)$old$,
    $new$jsonb_build_object('kit_metier',true,'assembly_id',source_assembly.id,'ouvrage_unit',coalesce(nullif(btrim(source_assembly.unit),''),'u'),'ouvrage_quantity',case when p_depth=0 then 1 else coalesce((select m.quantity from public.estimate_assembly_members m where m.parent_assembly_id=(select (i.source_metadata->>'assembly_id')::uuid from public.estimate_items i where i.id=p_parent_item_id) and m.child_assembly_id=source_assembly.id and m.position=p_section_position),1) end)$new$);
  if definition=previous then raise exception 'TI718_UNIT_ANCHOR'; end if;
  execute definition;
end $unit$;

-- Pure validation shared by the two existing commercial contracts. No data access.
create function public.estimate_offer_ouvrage_hierarchy_valid(rows_value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare row_value jsonb; cursor_value jsonb; chapters integer; ouvrages integer; visited text[]; row_index jsonb;
begin
  select jsonb_object_agg(r->>'id',r) into row_index from jsonb_array_elements(rows_value)r;
  for row_value in select * from jsonb_array_elements(rows_value) loop
    cursor_value:=row_value; chapters:=0; ouvrages:=0; visited:='{}';
    while cursor_value is not null loop
      if cursor_value->>'id'=any(visited) then return false; end if;
      visited:=array_append(visited,cursor_value->>'id');
      if cursor_value->>'kind'='section' then
        if cursor_value->'kitMetier'='true'::jsonb then ouvrages:=ouvrages+1; else chapters:=chapters+1; end if;
      end if;
      if chapters>4 or (ouvrages>3 and (row_value->>'depth')::integer>(case when row_value->>'kind'='section' then 3 else 4 end)) then return false; end if;
      if cursor_value->'parentId'='null'::jsonb then exit; end if;
      cursor_value:=row_index->(cursor_value->>'parentId');
    end loop;
  end loop;
  return true;
end $$;
revoke all on function public.estimate_offer_ouvrage_hierarchy_valid(jsonb) from public,anon,authenticated;
grant execute on function public.estimate_offer_ouvrage_hierarchy_valid(jsonb) to service_role;
do $contracts$
declare signature text; definition text; previous text;
begin
  foreach signature in array array['public.estimate_offer_client_valid(jsonb,jsonb)','public.estimate_offer_client_valid_v2(jsonb,jsonb)'] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    previous:=definition;
    definition:=replace(definition,$old$case when row_value->>'kind'='section' then 3 else 4 end$old$,
      $new$case when row_value->>'kind'='section' then 6 else 7 end$new$);
    definition:=replace(definition,'  -- Bounded strictly increasing parent depth',
      E'  if not public.estimate_offer_ouvrage_hierarchy_valid(rows_value) then return false; end if;\n  -- Bounded strictly increasing parent depth');
    if definition=previous or position('estimate_offer_ouvrage_hierarchy_valid(rows_value)' in definition)=0 then raise exception 'TI718_CONTRACT_DEPTH_ANCHOR %',signature; end if;
    execute definition;
  end loop;
end $contracts$;

-- Match the same chapter-depth semantics in the existing guarded move writers.
do $moves$
declare definition text; previous text;
begin
  select pg_get_functiondef('public.move_estimate_item(uuid,uuid,uuid,uuid,uuid[],uuid[])'::regprocedure) into definition;
  previous:=definition;
  definition:=replace(definition,'select parent.id, parent.parent_id, 1 as depth',
    $new$select parent.id, parent.parent_id, case when parent.source_metadata @> '{"kit_metier":true}'::jsonb then 0 else 1 end as depth$new$);
  definition:=replace(definition,'parent_chain.depth + 1',
    $new$parent_chain.depth + case when next_parent.source_metadata @> '{"kit_metier":true}'::jsonb then 0 else 1 end$new$);
  definition:=replace(definition,'next_section_level := target_parent_level + 1;',
    $new$next_section_level := target_parent_level + case when target_item.source_metadata @> '{"kit_metier":true}'::jsonb then 0 else 1 end;$new$);
  definition:=replace(definition,'select child.id, child.item_type, 1 as depth',
    $new$select child.id, child.item_type, case when child.source_metadata @> '{"kit_metier":true}'::jsonb then 0 else 1 end as depth$new$);
  definition:=replace(definition,'descendants.depth + 1',
    $new$descendants.depth + case when child.source_metadata @> '{"kit_metier":true}'::jsonb then 0 else 1 end$new$);
  if definition=previous then raise exception 'TI718_MOVE_ANCHOR'; end if;
  execute definition;
end $moves$;
commit;

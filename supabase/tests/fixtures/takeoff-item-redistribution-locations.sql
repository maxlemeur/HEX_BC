-- The SQL writer receives the server's compartments. These fixtures stand for
-- the real file reader, which the browser journey exercises with two PDF files.
create function pg_temp.location_input(tenant uuid,actor uuid,project uuid,version uuid,item uuid,mode text,module boolean)
returns jsonb language sql stable as $$
  with facts as (select public.read_takeoff_item_redistribution_documents(tenant,actor,project,version,item,module) doc),
  files as (select e.key,e.value,a.building,a.level,
      case when mode='together' then 'together' when mode='by_building' and a.building is not null then 'building:'||to_json(array[lower(a.building)])::text
        when mode='by_level' and a.level is not null then 'level:'||to_json(array[lower(a.building),lower(a.level)])::text else 'unallocated' end as compartment,
      case when mode='together' then 'Ensemble' when mode='by_building' then coalesce(a.building,'Non réparti')
        when a.level is not null then concat_ws(' · ',a.building,a.level) else 'Non réparti' end as label
    from facts cross join jsonb_each(doc->'parts') e left join public.takeoff_plan_locations a
      on a.tenant_id=tenant and a.project_id=project and a.plan_file_id=(e.value->>'file_id')::uuid and a.content_hash=e.value->>'hash')
  select doc||jsonb_build_object('parts',(select coalesce(jsonb_object_agg(key,jsonb_build_object('source',value,'key',compartment,
    'available',value#>>'{current_file,identity}' is not null,'label',label,'building_state',case when building is null then 'unknown' else 'confirmed' end,
    'level_state',case when level is null then 'unknown' else 'confirmed' end)),'{}') from files)) from facts
$$;
create function pg_temp.preview_read(tenant uuid,actor uuid,project uuid,version uuid,item uuid,mode text,module boolean)
returns jsonb language sql as $$
  select public.preview_takeoff_item_redistribution(tenant,actor,project,version,item,mode,module,
    pg_temp.location_input(tenant,actor,project,version,item,mode,module))
$$;
create function pg_temp.confirm_read(tenant uuid,actor uuid,project uuid,version uuid,item uuid,mode text,module boolean,request uuid,digest text)
returns jsonb language sql as $$
  select public.redistribute_takeoff_item(tenant,actor,project,version,item,mode,module,request,digest,
    pg_temp.location_input(tenant,actor,project,version,item,mode,module))
$$;

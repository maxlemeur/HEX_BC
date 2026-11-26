-- A whole-affaire entry can be withdrawn or attached to one plan. Keep the 0.9.0
-- command and journal vocabulary; the scope transition is in the journal payload.
set local lock_timeout = '2s';

create index takeoff_item_send_parts_project_item_idx
  on public.takeoff_item_send_parts (project_id, item_id) where state = 'live';

create index takeoff_entry_scope_history_idx on public.takeoff_item_review_events (tenant_id, project_id, item_id, id desc)
  where after->>'scope_action' in ('attach', 'replace', 'withdraw');

-- The released writer starts a missing entry at revision one. After a withdrawal or
-- transfer even an old client must distinguish a recreated total from the one it read.
create function private.continue_takeoff_whole_entry_revision()
returns trigger language plpgsql set search_path = '' as $$
declare removed_revision integer;
begin
  select (e.before->>'revision')::integer into removed_revision
    from public.takeoff_item_review_events e
    where (e.tenant_id,e.project_id,e.item_id) = (new.tenant_id,new.project_id,new.item_id)
      and e.after->>'scope_action' in ('attach','replace','withdraw')
    order by e.id desc limit 1;
  new.revision := coalesce(removed_revision, 0) + 1;
  return new;
end;
$$;
revoke all on function private.continue_takeoff_whole_entry_revision() from public, anon, authenticated, service_role;
create trigger continue_whole_entry_revision before insert on public.takeoff_item_entries
  for each row when (new.plan_logical_id is null and new.revision = 1)
  execute function private.continue_takeoff_whole_entry_revision();

create function public.change_takeoff_entry_scope(
  p_tenant_id uuid, p_project_id uuid, p_item_id uuid, p_intent_key uuid,
  p_action text, p_entry_revision integer, p_plan_entry_revision integer, p_plan_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  source public.takeoff_item_entries;
  destination public.takeoff_item_entries;
  written public.takeoff_item_entries;
  prior public.takeoff_item_review_commands;
  receipt uuid := gen_random_uuid();
  digest text;
  changed_at timestamptz;
  result jsonb;
begin
  if actor is null or p_tenant_id is distinct from public.current_tenant_id()
    or private.can_access_takeoff_scope(p_tenant_id,p_project_id,null,false) is not true
    or private.takeoff_item_list_writer(p_tenant_id,p_project_id,actor) is not true then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  if p_item_id is null or p_intent_key is null or
    (p_entry_revision > 0 and p_plan_entry_revision >= 0 and
      ((p_action='attach' and p_plan_id is not null) or
       (p_action='replace' and p_plan_id is not null and p_plan_entry_revision>0) or
       (p_action='withdraw' and p_plan_id is null and p_plan_entry_revision=0))) is not true then
    raise exception 'TAKEOFF_ITEM_REVIEW_INVALID' using errcode='22023';
  end if;
  digest := private.takeoff_sha256(jsonb_build_array('change_entry_scope',p_item_id,p_action,
    p_plan_id,p_entry_revision,p_plan_entry_revision));

  -- The project and review locks are shared with entry, publication and send writers.
  perform 1 from public.estimate_projects where (tenant_id,id)=(p_tenant_id,p_project_id) for share;
  perform pg_advisory_xact_lock(hashtextextended('takeoff-item-review:' || p_project_id,0));
  perform private.lock_takeoff_item_list(p_project_id);
  if private.lock_takeoff_measure_reviewer(p_tenant_id,p_project_id,actor) is not true then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  select * into prior from public.takeoff_item_review_commands
    where (tenant_id,project_id,intent_key)=(p_tenant_id,p_project_id,p_intent_key);
  if found then
    if prior.actor_id <> actor or prior.command_sha256 <> digest then
      raise exception 'TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT' using errcode='23505';
    end if;
    return prior.outcome || '{"replayed":true}'::jsonb;
  end if;

  select * into source from public.takeoff_item_entries
    where (tenant_id,project_id,item_id)=(p_tenant_id,p_project_id,p_item_id) and plan_logical_id is null for update;
  if source.revision is distinct from p_entry_revision then return '{"outcome":"stale"}'; end if;
  if p_plan_id is not null then
    select * into destination from public.takeoff_item_entries
      where (tenant_id,project_id,item_id,plan_logical_id)=(p_tenant_id,p_project_id,p_item_id,p_plan_id) for update;
    if coalesce(destination.revision,0) <> p_plan_entry_revision then return '{"outcome":"stale"}'; end if;
  end if;

  -- All estimate versions count, including issued versions. Revision keeps old parts as replaced.
  if exists (select from public.takeoff_item_send_parts where state='live'
    and (tenant_id,project_id,item_id)=(p_tenant_id,p_project_id,p_item_id)) then return '{"outcome":"sent"}'; end if;

  changed_at := clock_timestamp();
  if p_plan_id is not null then
    -- A dossier piece keeps its logical identity across generation or copy changes.
    -- FOR SHARE waits out an uncommitted deletion and protects the predicate through commit.
    perform 1 from public.affaire_intake_documents d
      where (d.tenant_id,d.project_id,d.id)=(p_tenant_id,p_project_id,p_plan_id) and d.document_kind='plans'
        and d.upload_status='uploaded' and d.deleted_at is null and d.deletion_token is null for share;
    if not found then
      -- A standalone upload is its own logical source while the recorded file still belongs to this affaire.
      perform 1 from public.plan_files f
        join public.plan_sets s on (s.id,s.tenant_id)=(f.plan_set_id,f.tenant_id)
        join public.takeoff_plan_location_sources l on (l.plan_file_id,l.plan_set_id,l.project_id,l.tenant_id)
          =(f.id,s.id,s.project_id,s.tenant_id)
        where (f.tenant_id,s.project_id,f.id)=(p_tenant_id,p_project_id,p_plan_id)
          and l.source_kind='plan_file' and l.source_id=f.id and f.metadata->>'source' is distinct from 'affaire-intake'
          and (public.can_access_takeoff_project(s.project_id,s.tenant_id)
            or private.can_read_takeoff_plan_evidence(f.tenant_id,s.id,f.id,f.file_path))
        for share of f,s,l;
      if not found then return '{"outcome":"ineligible"}'; end if;
    end if;
    if not exists (select from private.takeoff_item_reading_states(p_tenant_id,p_project_id,p_plan_id) l
      where l.item_id=p_item_id and l.state in ('not_found','uncertain')) then return '{"outcome":"ineligible"}'; end if;
    if p_action='attach' and destination.id is not null then
      return jsonb_build_object('outcome','collision','entry',private.takeoff_item_entry_document(destination));
    end if;
    if p_action='replace' then
      update public.takeoff_item_entries set quantity=source.quantity,unit=source.unit,category=source.category,
        note=source.note,included=source.category <> 'hypothesis',revision=destination.revision+1,
        previous_quantity=destination.quantity,previous_unit=destination.unit,actor_id=actor,entered_at=changed_at,command_id=receipt
        where id=destination.id returning * into strict written;
    else
      insert into public.takeoff_item_entries (tenant_id,project_id,item_id,plan_logical_id,quantity,unit,category,note,
        included,revision,actor_id,entered_at,command_id)
        values (p_tenant_id,p_project_id,p_item_id,p_plan_id,source.quantity,source.unit,source.category,source.note,
          source.category <> 'hypothesis',1,actor,changed_at,receipt) returning * into written;
    end if;
  end if;

  delete from public.takeoff_item_entries where id=source.id;
  insert into public.takeoff_item_review_events(tenant_id,project_id,command_id,item_id,plan_logical_id,event,before,after,actor_id,at)
    values(p_tenant_id,p_project_id,receipt,p_item_id,p_plan_id,'entered',
      private.takeoff_item_entry_document(source) || jsonb_build_object('destination',private.takeoff_item_entry_document(destination)),
      coalesce(private.takeoff_item_entry_document(written),'{}'::jsonb) || jsonb_build_object('scope_action',p_action),
      actor,changed_at);
  result := jsonb_build_object('outcome','applied','command_id',receipt,'item_id',p_item_id);
  insert into public.takeoff_item_review_commands(id,tenant_id,project_id,intent_key,actor_id,gesture,command_sha256,outcome,created_at)
    values (receipt,p_tenant_id,p_project_id,p_intent_key,actor,'enter_quantity',digest,result,changed_at);
  return result || '{"replayed":false}'::jsonb;
end;
$$;
revoke all on function public.change_takeoff_entry_scope(uuid,uuid,uuid,uuid,text,integer,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.change_takeoff_entry_scope(uuid,uuid,uuid,uuid,text,integer,integer,uuid) to authenticated;

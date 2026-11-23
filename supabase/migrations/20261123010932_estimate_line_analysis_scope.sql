begin;
set local lock_timeout = '5s';

-- The dry-run calls this same predicate with its own row visibility.
create function public.estimate_version_holds_analysis(p_tenant uuid, p_version uuid, p_job uuid)
returns boolean language sql stable strict set search_path = '' as $$
  select exists (
    select 1
    from public.estimate_versions v
    join public.takeoff_jobs j on j.project_id = v.project_id and j.tenant_id = v.tenant_id
    where v.id = p_version and v.tenant_id = p_tenant and j.id = p_job
      and (j.estimate_version_id = v.id or exists (
        select 1 from public.takeoff_version_links l
        where l.takeoff_job_id = j.id and l.tenant_id = j.tenant_id
          and l.source_version_id = j.estimate_version_id and l.target_version_id = v.id
      ))
  )
$$;
revoke all on function public.estimate_version_holds_analysis(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.estimate_version_holds_analysis(uuid,uuid,uuid) to authenticated, service_role;

-- A writing transaction stabilizes the two mutable inputs before checking.
-- The key of an attached job is immutable and the tenant FK protects its existence.
create function private.lock_estimate_analysis_scope(p_tenant uuid, p_version uuid, p_job uuid)
returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.estimate_versions v where v.id = p_version and v.tenant_id = p_tenant for share nowait;
  perform 1 from public.takeoff_version_links l where l.takeoff_job_id = p_job and l.target_version_id = p_version
    and l.tenant_id = p_tenant for share nowait;
end
$$;
revoke all on function private.lock_estimate_analysis_scope(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- Both the item send and version duplication finish the attachment later in
-- their transaction. Look up the current line: a queued event may be superseded.
create function private.check_estimate_line_analysis() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  line record;
begin
  select i.tenant_id, i.version_id, i.source_job_id into line from public.estimate_items i where i.id = new.id;
  if line.source_job_id is null then return null; end if;
  perform private.lock_estimate_analysis_scope(line.tenant_id, line.version_id, line.source_job_id);
  if not public.estimate_version_holds_analysis(line.tenant_id, line.version_id, line.source_job_id) then
    raise exception using errcode = 'M0A01', message = 'Cette version du devis ne détient pas cette analyse.';
  end if;
  return null;
end
$$;
revoke all on function private.check_estimate_line_analysis() from public, anon, authenticated, service_role;

-- Keep the tenant FK immediate, like the original FK. After the destination
-- policy admits the write, report a uniform refusal before the FK runs.
create function private.check_estimate_analysis_tenant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.takeoff_jobs j where j.id = new.source_job_id and j.tenant_id = new.tenant_id) then
    raise exception using errcode = 'M0A01', message = 'Cette version du devis ne détient pas cette analyse.';
  end if;
  return null;
end
$$;
revoke all on function private.check_estimate_analysis_tenant() from public, anon, authenticated, service_role;
create trigger "Analysis_tenant" after insert or update of source_job_id, tenant_id on public.estimate_items
  for each row when (new.source_job_id is not null) execute function private.check_estimate_analysis_tenant();

create constraint trigger estimate_line_analysis_scope after insert or update of id, source_job_id, tenant_id, version_id
  on public.estimate_items deferrable initially deferred for each row when (new.source_job_id is not null)
  execute function private.check_estimate_line_analysis();

create function private.check_estimate_analysis_unlink() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.estimate_items i where i.tenant_id = old.tenant_id
      and i.source_job_id = old.takeoff_job_id and i.version_id = old.target_version_id
      and not public.estimate_version_holds_analysis(i.tenant_id, i.version_id, i.source_job_id)
  ) then
    raise exception using errcode = 'M0A01', message = 'Cette version du devis ne détient pas cette analyse.';
  end if;
  return null;
end
$$;
revoke all on function private.check_estimate_analysis_unlink() from public, anon, authenticated, service_role;
create constraint trigger estimate_analysis_unlink after delete or update of tenant_id, takeoff_job_id, source_version_id, target_version_id
  on public.takeoff_version_links deferrable initially deferred for each row execute function private.check_estimate_analysis_unlink();

create function private.check_moved_version_analyses() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.estimate_items i where i.version_id = new.id and i.source_job_id is not null
      and not public.estimate_version_holds_analysis(i.tenant_id, i.version_id, i.source_job_id)
  ) then
    raise exception using errcode = 'M0A01', message = 'Cette version du devis ne détient pas cette analyse.';
  end if;
  return null;
end
$$;
revoke all on function private.check_moved_version_analyses() from public, anon, authenticated, service_role;
create constraint trigger estimate_version_analysis_move after update on public.estimate_versions
  deferrable initially deferred for each row
  when (old.project_id is distinct from new.project_id or old.tenant_id is distinct from new.tenant_id)
  execute function private.check_moved_version_analyses();

-- Preserve the relationship name and its delete action. Install and validate
-- the new key before taking the stronger catalog lock for the final swap.
alter table public.estimate_items add constraint estimate_items_analysis_tenant_fkey
  foreign key (source_job_id, tenant_id) references public.takeoff_jobs(id, tenant_id)
  on delete set null (source_job_id) not valid;
alter table public.estimate_items validate constraint estimate_items_analysis_tenant_fkey;

do $$
declare invalid_count bigint;
begin
  select count(*) into invalid_count from public.estimate_items i where i.source_job_id is not null
    and not public.estimate_version_holds_analysis(i.tenant_id, i.version_id, i.source_job_id);
  if invalid_count > 0 then
    raise exception 'Estimate lines with an out-of-scope analysis: %', invalid_count;
  end if;
end
$$;
alter table public.estimate_items drop constraint estimate_items_source_job_id_fkey;
alter table public.estimate_items rename constraint estimate_items_analysis_tenant_fkey to estimate_items_source_job_id_fkey;

-- Retain the installed writer bodies, including the later ouvrage resize in the batch.
do $writer$
declare
  body text := pg_get_functiondef('public.copy_estimate_items_atomic(uuid,uuid,jsonb)'::regprocedure);
  anchor text;
begin
  anchor := $old$item.selected_supplier_price_id, item.source_provider, item.source_job_id,$old$;
  if cardinality(string_to_array(body, anchor)) <> 2 then raise exception 'Unexpected writer definition'; end if;
  body := replace(body, anchor, $new$item.selected_supplier_price_id, item.source_provider,
    case when public.estimate_version_holds_analysis(target_tenant_id, p_version_id, item.source_job_id)
      then item.source_job_id end,$new$);
  execute body;
end
$writer$;

do $writer$
declare
  body text := pg_get_functiondef('public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  anchor text;
begin
  anchor := $old$        if item.source_job_id is not null then
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
        end if;$old$;
  if cardinality(string_to_array(body, anchor)) <> 2 then raise exception 'Unexpected writer definition'; end if;
  body := replace(body, anchor, $new$        if item.source_job_id is not null then
          perform 1 from public.takeoff_jobs j where j.id=item.source_job_id and j.tenant_id=target_tenant for share nowait;
          perform private.lock_estimate_analysis_scope(target_tenant, p_version_id, item.source_job_id);
          if not public.estimate_version_holds_analysis(target_tenant, p_version_id, item.source_job_id) then
            raise exception using errcode='M0A01', message='Cette version du devis ne détient pas cette analyse.';
          end if;
        end if;$new$);
  anchor := $old$    if failure_message='ESTIMATE_V3_PROJECTION_MISMATCH'$old$;
  if cardinality(string_to_array(body, anchor)) <> 2 then raise exception 'Unexpected writer definition'; end if;
  body := replace(body, anchor, $new$    if failure_code='M0A01' then failure_message:='ESTIMATE_ANALYSIS_OUT_OF_SCOPE'; end if;
    if failure_message='ESTIMATE_V3_PROJECTION_MISMATCH'$new$);
  anchor := $old$if failure_message not in('ESTIMATE_BATCH_INVALID_INPUT'$old$;
  if cardinality(string_to_array(body, anchor)) <> 2 then raise exception 'Unexpected writer definition'; end if;
  body := replace(body, anchor, $new$if failure_message not in('ESTIMATE_ANALYSIS_OUT_OF_SCOPE','ESTIMATE_BATCH_INVALID_INPUT'$new$);
  anchor := $old$'message','Le lot a été annulé.'$old$;
  if cardinality(string_to_array(body, anchor)) <> 2 then raise exception 'Unexpected writer definition'; end if;
  body := replace(body, anchor, $new$'message',case when failure_code='M0A01' then 'Cette version du devis ne détient pas cette analyse.' else 'Le lot a été annulé.' end$new$);
  execute body;
end
$writer$;

commit;

-- The send plan carries a marks revision only for a verified count. Keep the
-- same part shape when its source comes from a pending contribution revision.
create or replace function private.takeoff_revision_items(p_tenant uuid,p_project uuid,p_version uuid,p_receipt uuid,p_job uuid)
returns setof jsonb language sql stable set search_path='' as $$
  with receipt as (
    select r.* from public.takeoff_item_send_receipts r where r.id=p_receipt
      and (r.tenant_id,r.project_id,r.version_id)=(p_tenant,p_project,p_version)
  ), settled as (
    select x.key as answer_key,x.value as proof from receipt r cross join lateral jsonb_each(
      coalesce(r.result->'reviewed',r.write_plan->'reviewed','{}')) x
  ), local_parts as materialized (
    select p.answer_id,jsonb_agg(to_jsonb(p) order by p.id) as parts,
      min(p.marks_revision) as marks_revision from public.takeoff_item_send_parts p
    where p.tenant_id=p_tenant and p.project_id=p_project and p.version_id=p_version and p.job_id=p_job and p.state='live'
    group by p.answer_id
  ), latest as materialized (
    select distinct on (w.answer_id) w.* from private.takeoff_revision_choices w
    where w.tenant_id=p_tenant and w.project_id=p_project and w.version_id=p_version and w.job_id=p_job
    order by w.answer_id,w.revision desc
  ), edited as (
    select e.answer_id,max(e.revision) as revision from public.takeoff_count_mark_events e
    join public.takeoff_count_mark_commands c on c.id=e.command_id and c.kind='edit'
      and c.result ? 'amended_receipt_id'
    join public.takeoff_item_answers a on a.id=e.answer_id and a.job_id=p_job
    where e.tenant_id=p_tenant and e.project_id=p_project
    group by e.answer_id
  ), changes as (
    select a as answer, w as work,coalesce(lp.parts,'[]') as before_parts,
      private.takeoff_count_marks_revision(a.id) as marks_revision, f.proof, e.revision as edit_revision
    from public.takeoff_item_answers a left join local_parts lp on lp.answer_id=a.id
    left join latest w on w.answer_id=a.id left join edited e on e.answer_id=a.id
    left join settled f on f.answer_key=a.id::text
    left join public.takeoff_item_entries entry on entry.tenant_id=a.tenant_id and entry.project_id=a.project_id
      and entry.item_id=a.item_id and entry.plan_logical_id=a.plan_logical_id
    where a.tenant_id=p_tenant and a.project_id=p_project and a.job_id=p_job and not a.comparison_only
      -- A later confirmed reading supersedes this working correction. An older
      -- receipt remains readable; there is no further change to confirm on it.
      and not exists(select 1 from public.takeoff_item_send_parts newer
        join public.takeoff_item_answers n on n.id=newer.answer_id and n.job_id=newer.job_id
        where newer.version_id=p_version and newer.tenant_id=p_tenant and newer.state='live'
          and (newer.item_id,newer.plan_logical_id)=(a.item_id,a.plan_logical_id)
          and newer.job_id<>p_job and n.reading_revision>a.reading_revision and not n.comparison_only
          and not exists(select 1 from public.takeoff_item_send_parts own
            where own.version_id=p_version and own.answer_id=a.id and own.state='live'))
      and (coalesce(w.revision,0)>coalesce((f.proof->>'work_revision')::integer,0)
      -- Surface a newly saved shared hypothesis on the addressed reading even
      -- if its original sent source was a count. Its inclusion changes no line.
      or (entry.category='hypothesis' and not entry.included
        and f.proof->>'entry_revision' is distinct from entry.revision::text
        and exists(select 1 from public.takeoff_item_review_commands cmd
          where cmd.id=entry.command_id and cmd.tenant_id=a.tenant_id and cmd.project_id=a.project_id
            and cmd.outcome ? 'amended_receipt_id' and cmd.outcome->>'answer_id'=a.id::text))
      or (lp.parts#>>'{0,kind}'='entered' and lp.parts#>>'{0,entry_id}'=entry.id::text
        and (lp.parts#>>'{0,entry_revision}')::integer<>entry.revision and f.proof->>'entry_revision' is distinct from entry.revision::text)
      or coalesce(e.revision,0)>coalesce((f.proof->>'marks_revision')::integer,lp.marks_revision,0)
      or (lp.marks_revision is not null and lp.marks_revision<>private.takeoff_count_marks_revision(a.id)
        and f.proof->>'marks_revision' is distinct from private.takeoff_count_marks_revision(a.id)::text))
  )
  select jsonb_build_object('item_id',(c.answer).item_id,'answer_id',(c.answer).id,'answer_revision',(c.answer).content_sha256,
    'label',s.label,'plan_id',(c.answer).plan_logical_id,'job_id',p_job,'marks_revision',c.marks_revision,
    'work_revision',coalesce((c.work).revision,0),'work_id',(c.work).id,'before_parts',c.before_parts,
    'choice',(c.work).choice,'source',picked.source,'quantity',retained.qty,
    'ready',picked.source is not null and retained.qty is not null and
      (not picked.has_choice or ((c.work).proof->>'sources_sha256'=private.takeoff_sha256(facts) and
        (c.work).proof->'marks_revision'=to_jsonb(c.marks_revision) and (c.work).proof->'plan_entry_revision'=facts->'plan_entry_revision')) and private.takeoff_count_answer_is_current(c.answer)
      and exists(select 1 from private.takeoff_item_reading_pairs(p_tenant,p_project,(c.answer).plan_logical_id) pair
        where pair.answer_id=(c.answer).id and pair.reading='answered')
      and (picked.source='withdraw' or (facts->'whole_entry'='false' and facts#>'{entry,included}' is distinct from 'false'::jsonb
        and ((c.answer).outcome<>'measured' or facts->'anomaly'='false') and (facts->>'reference' is null or
          not private.takeoff_quantity_requires_review((facts->>'reference')::numeric,retained.qty))
        and (facts->>'unit' is null or private.takeoff_item_send_unit(retained.unit)=private.takeoff_item_send_unit(facts->>'unit')))),
    'facts',facts,'parts',coalesce(parts.data,'[]')) from changes c
  join public.takeoff_list_revision_entries s on s.revision_id=(c.answer).list_revision_id and s.item_id=(c.answer).item_id
  cross join lateral private.takeoff_revision_sources(c.answer) facts
  cross join lateral (select coalesce((c.work).revision,0)>coalesce((c.proof->>'work_revision')::integer,0) as pending) diff
  cross join lateral (select diff.pending as has_choice,case when diff.pending then (c.work).choice->>'source'
    when c.before_parts#>>'{0,kind}' in ('entered','verified_count') then c.before_parts#>>'{0,kind}' end as source) picked
  cross join lateral (select case picked.source when 'entered' then (facts#>>'{entry,quantity}')::numeric
    when 'verified_count' then (facts#>>'{verified,quantity}')::numeric when 'withdraw' then 0 when 'measured' then (facts->>'measured')::numeric end as qty,
    case picked.source when 'entered' then facts#>>'{entry,unit}' when 'verified_count' then facts#>>'{verified,unit}'
      when 'measured' then facts->>'measured_unit' end as unit) retained
  left join lateral (
    select jsonb_agg(jsonb_build_object('item_id',(c.answer).item_id,'answer_id',(c.answer).id,'answer_revision',(c.answer).content_sha256,
      'plan_logical_id',(c.answer).plan_logical_id,'kind',picked.source,'quantity',src.quantity,'unit',src.unit,
      'pages',src.pages,'observation_id',src.observation_id,'takeoff_item_id',src.takeoff_item_id,'basis',src.basis,
      'decision_revision',coalesce((c.work).revision,(c.before_parts#>>'{0,decision_revision}')::integer),
      'entry_id',case when picked.source='entered' then (facts#>>'{entry,id}')::uuid end,
      'entry_revision',case when picked.source='entered' then (facts#>>'{entry,revision}')::integer end,
      'takeoff_item_ids',case when picked.source='verified_count' then (select coalesce(array_agg(i.id order by i.id),'{}'::uuid[])
        from public.takeoff_item_answer_observations o join public.takeoff_items i on i.id=o.takeoff_item_id
        where o.answer_id=(c.answer).id and o.role='contribution' and not i.is_excluded) end)
      || case when picked.source='verified_count' then jsonb_build_object('marks_revision',c.marks_revision)
        else '{}'::jsonb end order by src.observation_id) as data
    from (
      select i.quantity,i.unit,array(select i.source_page where i.source_page>0) pages,o.id as observation_id,
        i.id as takeoff_item_id,o.measurement_basis as basis from public.takeoff_item_answer_observations o
      join public.takeoff_items i on i.id=o.takeoff_item_id and i.tenant_id=p_tenant and i.job_id=p_job
      where picked.source='measured' and o.answer_id=(c.answer).id and o.role='contribution' and not i.is_excluded
      union all select (facts#>>'{verified,quantity}')::numeric,facts#>>'{verified,unit}',
        array(select q::integer from jsonb_array_elements_text(facts#>'{verified,pages}') q),null,null,null
      where picked.source='verified_count' and facts#>>'{verified,quantity}' is not null
      union all select retained.qty,retained.unit,d.unit_pages,null,null,null
      from public.takeoff_jobs j join public.takeoff_launch_requests r on r.id=j.launch_request_id
      cross join lateral private.takeoff_item_send_plan_read(j,r.manifest) d where j.id=p_job and picked.source='entered'
    ) src
  ) parts on true order by (c.answer).item_id
$$;

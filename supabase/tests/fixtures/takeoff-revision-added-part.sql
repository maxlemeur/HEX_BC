-- Start with the confirmed count in affaire 21. Replace it with the chosen
-- source, withdraw that last part, then add the item to the freed compartment.
create function pg_temp.revision_part_lifecycle(source_ text) returns jsonb language plpgsql as $$
declare
  m record;
  project_ uuid := pg_temp.f(21);
  item_ uuid := pg_temp.f(310);
  tenant_ uuid := pg_temp.tenant();
  actor_ uuid := pg_temp.f(1);
  step text;
  answer_ public.takeoff_item_answers;
  part_ public.takeoff_item_send_parts;
  preview_ jsonb;
  confirmed jsonb;
  choices jsonb;
  plan_ jsonb;
  contribution jsonb;
  observations uuid[] := '{}';
  pages integer[] := case when source_='entered' then array[2,7] else array[2] end;
  quantity_ numeric := case source_ when 'entered' then 4.5 when 'measured' then 2 else 1 end;
  work integer := 0;
  result_ jsonb := '{}';
begin
  begin
    select * into strict m from revision_mark_request;
    select * into strict answer_ from public.takeoff_item_answers where id=m.answer_id;
    if source_='measured' then
      select array_agg(o.id) into observations from public.takeoff_item_answer_observations o
        where o.answer_id=answer_.id and o.role='contribution';
    end if;
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,actor_,tenant_,clock_timestamp()+interval '15 minutes',gen_random_uuid());
    foreach step in array array['replace','withdraw','add'] loop
      choices := '{}';
      perform pg_temp.revision_choice(case when step='withdraw' then 'withdraw' else source_ end,2,work,
        case when step='withdraw' then '{"reason":"duplicate"}'::jsonb
          when step='replace' and source_='entered' then '{"quantity":4.5,"unit":"u","category":"site_survey"}'::jsonb
          else '{}'::jsonb end);
      if step='add' then
        -- The send format carries a marks revision only for a verified count.
        contribution := jsonb_build_object('answer_id',answer_.id,'answer_revision',answer_.content_sha256,
          'kind',source_,'quantity',quantity_,'unit','u','observation_ids',observations,'pages',pages,
          'identity',jsonb_build_object('unit','u','basis',null,'network',null,'diameter',null,'material',null))
          || case when source_='verified_count' then '{"marks_revision":2}'::jsonb else '{}'::jsonb end;
        plan_ := pg_temp.plan(21,m.draft,310,quantity_) || '{"sections":[]}'::jsonb;
        plan_ := jsonb_set(plan_,'{targets,0,contributions}',jsonb_build_array(contribution));
        plan_ := jsonb_set(plan_,'{targets,0,line,section_id}',(select to_jsonb(s.estimate_item_id)
          from public.takeoff_item_send_sections s where s.version_id=m.draft and s.section_key='list:'));
        plan_ := jsonb_set(plan_,'{page_contributions}',(select jsonb_agg(jsonb_build_object('page',p,
          'item_ids',array[item_],'target_keys',array[item_::text||'|together'],'observation_ids',observations) order by p)
          from unnest(pages) p));
        if source_='entered' then
          plan_ := jsonb_set(plan_,'{dependencies,answers,0,entry_revision}',(select to_jsonb(e.revision)
            from public.takeoff_item_entries e where e.item_id=item_ and e.plan_logical_id=answer_.plan_logical_id
            and e.project_id=project_ and e.tenant_id=tenant_));
        end if;
        choices := jsonb_build_object('send_plan',plan_);
      end if;
      preview_ := public.preview_takeoff_contribution_revision(tenant_,actor_,project_,m.draft,m.receipt,true,choices);
      confirmed := public.confirm_takeoff_contribution_revision(tenant_,actor_,project_,m.draft,m.receipt,true,
        gen_random_uuid(),preview_->>'digest',choices);
      m.receipt := (confirmed->>'receipt_id')::uuid;
      update revision_mark_request set receipt=m.receipt;
      if step='withdraw' then
        result_ := result_ || jsonb_build_object(step,(select count(*) from public.takeoff_item_send_parts
          where version_id=m.draft and answer_id=answer_.id and state='live'));
      else
        select * into strict part_ from public.takeoff_item_send_parts where receipt_id=m.receipt
          and version_id=m.draft and answer_id=answer_.id and state='live';
        result_ := result_ || jsonb_build_object(step,jsonb_build_array(part_.kind,part_.quantity,part_.marks_revision));
      end if;
      work := work+1;
    end loop;
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return result_;
    when others then return result_ || jsonb_build_object(step,jsonb_build_object('error',sqlerrm,'blockers',preview_->'blockers'));
  end;
end;
$$;

create temp table revision_lifecycles as
  select source,pg_temp.revision_part_lifecycle(source) as actual,
    jsonb_build_array(source,quantity,proof) as expected_part
  from (values ('entered',4.5,null::integer),('measured',2,null),('verified_count',1,2)) as cases(source,quantity,proof);

select is(actual->step,case when step='withdraw' then '0'::jsonb else expected_part end,
  format('%s a %s contribution and read its live journal part and count proof',step,source))
from revision_lifecycles cross join (values ('replace'),('withdraw'),('add')) as steps(step);

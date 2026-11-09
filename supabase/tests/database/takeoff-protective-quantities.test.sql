-- TI-680: real authenticated apply, preserved documentary source and engine amounts.
-- Isolated SQL covers atomic rollback and both engines; the Army journey covers the screen and API.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
  raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','68000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','quantity-policy@example.test',crypt('test-password',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
select set_config('test.tenant_id',(select tenant_id::text from public.tenant_memberships
  where user_id='68000000-0000-4000-8000-000000000001' limit 1),true);

create temporary table p680_cases (case_name text, version_id uuid, section_id uuid, target_id uuid, job_id uuid,
  plan jsonb, expected numeric, permit text) on commit drop;
grant select on p680_cases to authenticated;

do $seed$
declare e integer; n integer; p uuid := gen_random_uuid(); v uuid; s uuid; t uuid; j uuid; i uuid;
  q numeric; policy jsonb; sources jsonb; mapping jsonb; target_revision timestamptz;
begin
  insert into public.estimate_projects(id,tenant_id,user_id,name) values(p,current_setting('test.tenant_id')::uuid,
    '68000000-0000-4000-8000-000000000001','TI-680 fictif');
  foreach e in array array[2,3] loop
    for n in 1..4 loop
      v:=gen_random_uuid(); s:=gen_random_uuid(); t:=gen_random_uuid(); j:=gen_random_uuid();
      insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,max_section_depth,
        currency,status,margin_mode,margin_multiplier,margin_bp,global_coefficient,discount_bp,discount_mode,tax_rate_bp,
        rounding_mode,rounding_step_cents,sale_coefficient_fo,sale_coefficient_mo,gross_ht_cents,discount_applied_cents,
        commercial_rounding_cents,total_ht_cents,total_tax_cents,total_ttc_cents)
      values(v,current_setting('test.tenant_id')::uuid,p,e*10+n,e,3,'EUR','draft','fixed',1,0,1,0,'simple',2000,
        'none',1,case when e=3 then 1 end,case when e=3 then 1 end,
        case when e=3 then 0 end,case when e=3 then 0 end,case when e=3 then 0 end,0,0,0);
      if e=3 then perform set_config('miaouffrage.estimate_v3_writer',v::text,true); end if;
      insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title)
      values(s,current_setting('test.tenant_id')::uuid,v,'section',1,'Réseaux fictifs');
      insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,
        quantity,unit_code,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,
        line_tax_cents,line_total_ttc_cents,source_provider,source_file_name,source_page,source_metadata,fo_provision)
      values(t,current_setting('test.tenant_id')::uuid,v,s,'line',1,'EF cuivre DN 22','ml',3000,
        case when e=3 then 'ml' end,1000,2000,1,0,1,1000,3000000,600000,3600000,'dpgf','dpgf-fictif.xlsx',7,
        '{"dpgf_source_quantity":3000,"dpgf_source_unit":"ml","fixture":"preserve"}',1);
      if e=3 then perform public.estimate_v3_complete_entry_for_writer(v,array[t]); end if;
      perform set_config('miaouffrage.estimate_v3_writer','',true);
      insert into public.draft_locks(tenant_id,version_id,user_id,expires_at,session_id)
      values(current_setting('test.tenant_id')::uuid,v,'68000000-0000-4000-8000-000000000001',now()+interval '1 hour',gen_random_uuid());
      select updated_at into target_revision from public.estimate_items where id=t;
      insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,status,source_file_name,created_by)
      values(j,current_setting('test.tenant_id')::uuid,v,'A','completed','plan-fictif.pdf','68000000-0000-4000-8000-000000000001');
      sources:='[]'; mapping:='[]';
      for q in select unnest(case when n=1 then array[2980::numeric] when n=2 then array[3020::numeric]
        else array[1500::numeric,1520::numeric] end) loop
        i:=gen_random_uuid();
        insert into public.takeoff_items(id,tenant_id,job_id,designation,quantity,unit,confidence,evidence,source_file_name,source_page,created_at)
        values(i,current_setting('test.tenant_id')::uuid,j,'EF cuivre DN 22',q,'ml',0.99,'Mesure fictive localisée','plan-fictif.pdf',1,
          now()+jsonb_array_length(mapping)*interval '1 second');
        sources:=sources||jsonb_build_array(jsonb_build_object('id',i,'quantity',q,'updated_at',
          (select updated_at from public.takeoff_items where id=i)));
        mapping:=mapping||jsonb_build_array(jsonb_build_object('item_id',i,'source_order',jsonb_array_length(mapping),
          'rule_id',null,'action','none','designation','EF cuivre DN 22','unit_price_cents',null,'category_id',null,'assembly_id',null));
      end loop;
      policy:=jsonb_build_array(jsonb_build_object('target_id',t,'expected_updated_at',target_revision,
        'reference_quantity',3000,'measured_quantity',case when n=1 then 2980 else 3020 end,
        'priced_quantity',case when n=1 then 3000 else 3020 end,'absolute_gap',20,'reviewed',false,'source_file_name','dpgf-fictif.xlsx',
        'source_page',7,'source_metadata',jsonb_build_object('dpgf_source_quantity',3000,'dpgf_source_unit','ml','fixture','preserve'),
        'takeoff_items',sources));
      insert into public.takeoff_apply_authorizations(tenant_id,job_id,estimate_version_id,user_id,authorization_token_hash,
        review_summary,expires_at)
      values(current_setting('test.tenant_id')::uuid,j,v,'68000000-0000-4000-8000-000000000001',
        encode(sha256(convert_to(j::text,'UTF8')),'hex'),jsonb_build_object('quantity_policy',policy,
          'quantity_sources',(select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at,'quantity',quantity,
            'designation',designation,'unit',unit,'is_excluded',is_excluded)) from public.takeoff_items where job_id=j)),
        now()+interval '5 minutes');
      if n=4 then
        -- A previously unexamined item appears after the permit was issued. No partial apply is allowed.
        insert into public.takeoff_items(tenant_id,job_id,designation,quantity,unit,confidence,evidence,source_file_name,source_page)
        values(current_setting('test.tenant_id')::uuid,j,'EF cuivre DN 28',50,'ml',0.99,'Fictif','plan-fictif.pdf',1);
      end if;
      insert into p680_cases values(e||'-'||n,v,s,t,j,mapping,case when n=1 then 3000 else 3020 end,j::text);
    end loop;
  end loop;
end;
$seed$;

create function pg_temp.p680_apply(job uuid, section uuid, plan jsonb, permit text) returns text
language plpgsql security definer set search_path=pg_catalog as $$ begin
  -- Separate production HTTP transactions naturally drop these legacy ON COMMIT tables.
  -- This pgTAP file intentionally exercises several calls in one rollback-only transaction.
  drop table if exists pg_temp._takeoff_apply_source;
  drop table if exists pg_temp._takeoff_apply_created_ids;
  drop table if exists pg_temp._takeoff_apply_matches;
  drop table if exists pg_temp._takeoff_apply_unmatched;
  perform * from public.apply_takeoff_job_guarded_atomic(job,'merge',section,plan,permit);
  return 'ok';
exception when others then return sqlstate||' '||sqlerrm; end $$;
grant execute on function pg_temp.p680_apply(uuid,uuid,jsonb,text) to authenticated;
create temporary view p680_success as select * from p680_cases where case_name not like '%-4';
grant select on p680_success to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"68000000-0000-4000-8000-000000000001"}',true);
select is(pg_temp.p680_apply(job_id,section_id,plan,permit),'40001 TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE',
  case_name||': a new source invalidates the full comparison snapshot') from p680_cases where case_name like '%-4';
select is(pg_temp.p680_apply(job_id,section_id,plan,permit),'ok',case_name||': authenticated reconciliation succeeds') from p680_success;
reset role;
select is(item.quantity,fixture.expected,case_name||': protected quantity reaches the estimate')
  from p680_success fixture join public.estimate_items item on item.id=fixture.target_id;
select is(item.line_total_ht_cents,(fixture.expected*1000)::integer,case_name||': amount uses protected quantity')
  from p680_success fixture join public.estimate_items item on item.id=fixture.target_id;
select ok(item.source_provider='dpgf' and item.source_file_name='dpgf-fictif.xlsx' and item.source_page=7
    and item.source_metadata->>'fixture'='preserve' and item.source_metadata->>'dpgf_source_quantity'='3000',
    case_name||': original reference and provenance survive')
  from p680_success fixture join public.estimate_items item on item.id=fixture.target_id;
select is((select count(*) from public.estimate_items item where item.version_id=fixture.version_id and item.item_type='line'),
  1::bigint,case_name||': multiple plan contributions do not duplicate the DPGF price line') from p680_success fixture;
select is(item.source_metadata#>>'{takeoff_quantity_policy,measured_quantity}',
  case when fixture.case_name like '%-1' then '2980' else '3020' end,case_name||': independent measurement survives')
  from p680_success fixture join public.estimate_items item on item.id=fixture.target_id;
select is(job.status::text,'completed',case_name||': refused stale apply rolls back the job state')
  from p680_cases fixture join public.takeoff_jobs job on job.id=fixture.job_id where case_name like '%-4';
-- Duplication preserves the evidence actually accepted, including null legacy
-- snapshots and stale snapshots. It must neither drop nor freshly certify them.
insert into public.takeoff_dpgf_review_decisions(tenant_id,version_id,takeoff_job_id,estimate_item_id,
  review_reference,line_label,line_position,source_file_name,source_page,decision,reason,quantity_snapshot)
select current_setting('test.tenant_id')::uuid,version_id,job_id,target_id,'snapshot-'||case_name,
  'EF cuivre DN 22',1,'dpgf-fictif.xlsx',7,'keep_dpgf','Fictif : conserver la preuve examinée',
  case when case_name like '%-2' then null else jsonb_build_object('version',1,'reference',
    case when case_name like '%-3' then 2999 else 3000 end,'unit','ml','items',jsonb_build_array(
      jsonb_build_object('id',job_id,'quantity',2980))) end
from p680_success;
create temporary table p680_duplicates(source_version uuid, copied_version uuid) on commit drop;
grant select,insert on p680_duplicates to authenticated;
set local role authenticated;
insert into p680_duplicates select version_id,public.duplicate_estimate_version(version_id,false) from p680_success;
reset role;
select is((select count(*) from public.takeoff_dpgf_review_decisions copied
    where copied.version_id=duplicate.copied_version and copied.takeoff_job_id=fixture.job_id),
  1::bigint,fixture.case_name||': duplication carries exactly one decision')
from p680_success fixture join p680_duplicates duplicate on duplicate.source_version=fixture.version_id;
select is(copied.quantity_snapshot,source.quantity_snapshot,
  fixture.case_name||': duplication preserves accepted, legacy or stale quantity evidence verbatim')
from p680_success fixture join p680_duplicates duplicate on duplicate.source_version=fixture.version_id
join public.takeoff_dpgf_review_decisions source on source.version_id=fixture.version_id and source.estimate_item_id=fixture.target_id
join public.takeoff_dpgf_review_decisions copied on copied.version_id=duplicate.copied_version and copied.takeoff_job_id=fixture.job_id;

select * from finish();
rollback;

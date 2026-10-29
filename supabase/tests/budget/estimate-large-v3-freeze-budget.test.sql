-- Full workbook freeze witness: missing from the previous creation/settings budgets.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(4);
set local test.freeze_runs = '7';
\ir ../fixtures/large-v3-estimate.sql
select pg_temp.lb29_run(1);
create temp table freeze_samples(run integer,ms numeric,revision_delta bigint,item_audits bigint,version_steps bigint);
create function pg_temp.freeze_probe() returns void language plpgsql as $$
declare
 target_version public.estimate_versions%rowtype;
 computed jsonb;
 expected_context jsonb;
 expected_items jsonb;
 expected_totals jsonb;
 started timestamptz;
 elapsed numeric;
 revision_delta bigint;
 item_audits bigint;
 version_steps bigint;
 audits_before timestamptz;
begin
 select * into target_version from public.estimate_versions where id='29200000-0000-4000-8000-000000000101';
 computed := private.estimate_v3_compute(target_version.id);
  expected_context := jsonb_build_object(
    'engine', 3,
    'labor_split_enabled', computed -> 'params' -> 'labor_split_enabled',
    'labor_roles', computed -> 'labor_roles',
    'sale_coefficients', jsonb_build_object(
      'fo', computed -> 'params' -> 'sale_coefficient_fo',
      'mo', computed -> 'params' -> 'sale_coefficient_mo'
    ),
    'discount', jsonb_build_object(
      'kind', case
        when target_version.discount_amount_cents is not null then 'amount'
        when target_version.discount_bp > 0 then 'rate'
        else 'none'
      end,
      'requested_cents', target_version.discount_amount_cents,
      'rate_bp', case
        when target_version.discount_amount_cents is null and target_version.discount_bp > 0
          then target_version.discount_bp
      end,
      'base_cents', computed -> 'totals' -> 'gross_ht_cents',
      'applied_cents', computed -> 'totals' -> 'discount_applied_cents'
    ),
    'commercial_rounding', jsonb_build_object(
      'mode', target_version.rounding_mode::text,
      'step_cents', target_version.rounding_step_cents,
      'applied_cents', computed -> 'totals' -> 'commercial_rounding_cents'
    ),
    'cost_subtotal_cents', computed -> 'totals' -> 'cost_subtotal_cents',
    'realized_sale_coefficient', (computed -> 'totals' ->> 'realized_sale_coefficient')::numeric,
    'tax_breakdown', computed -> 'totals' -> 'tax_breakdown'
  );

  select coalesce(jsonb_object_agg(line.value ->> 'id', jsonb_build_object(
      'snapshot_pu_ht_cents', line.value -> 'pu_ht_cents',
      'snapshot_gross_ht_cents', line.value -> 'gross_ht_cents',
      'snapshot_gross_fo_ht_cents', line.value -> 'gross_fo_ht_cents',
      'snapshot_fo_ht_cents', line.value -> 'snapshot_fo_ht_cents',
      'snapshot_mo_ht_cents', line.value -> 'snapshot_mo_ht_cents',
      'snapshot_mo_atelier_ht_cents', line.value -> 'snapshot_mo_atelier_ht_cents',
      'snapshot_mo_chantier_ht_cents', line.value -> 'snapshot_mo_chantier_ht_cents',
      'line_total_ht_cents', line.value -> 'line_total_ht_cents',
      'line_tax_cents', line.value -> 'line_tax_cents',
      'line_total_ttc_cents', line.value -> 'line_total_ttc_cents'
    )), '{}'::jsonb)
    into expected_items
  from jsonb_array_elements(computed -> 'lines') line(value);

  expected_totals := jsonb_build_object(
    'gross_ht_cents', computed -> 'totals' -> 'gross_ht_cents',
    'discount_applied_cents', computed -> 'totals' -> 'discount_applied_cents',
    'commercial_rounding_cents', computed -> 'totals' -> 'commercial_rounding_cents',
    'total_ht_cents', computed -> 'totals' -> 'total_ht_cents',
    'total_tax_cents', computed -> 'totals' -> 'total_tax_cents',
    'total_ttc_cents', computed -> 'totals' -> 'total_ttc_cents',
    'rounding_adjustment_cents', 0
  );


 for i in 1..coalesce(nullif(current_setting('test.freeze_runs',true),''),'1')::integer loop
  begin
   perform set_config('request.jwt.claims','{"role":"service_role"}',true);
   perform set_config('role','service_role',true);
   delete from public.audit_logs where estimate_version_id=target_version.id;
   started:=clock_timestamp();
   perform public.freeze_estimate_v3_snapshot(target_version.id,target_version.tenant_id,target_version.updated_at,
    target_version.content_revision,'29200000-0000-4000-8000-000000000001','send',expected_context,
    (select jsonb_agg(jsonb_build_object('id',key)||value) from jsonb_each(expected_items)),expected_totals);
   elapsed:=extract(epoch from clock_timestamp()-started)*1000;
   select content_revision-target_version.content_revision into revision_delta from public.estimate_versions where id=target_version.id;
   select count(*) into item_audits from public.audit_logs where estimate_version_id=target_version.id and table_name='estimate_items';
   select count(*) into version_steps from public.audit_logs where estimate_version_id=target_version.id and table_name='estimate_versions'
    and (after_data->>'content_revision')::bigint=(before_data->>'content_revision')::bigint+1;
   raise exception using errcode='P0201' ,message='rollback sample';
  exception when sqlstate 'P0201' then
   perform set_config('role','none',true);
   insert into freeze_samples values(i,elapsed,revision_delta,item_audits,version_steps);
  end;
 end loop;
end $$;
select pg_temp.freeze_probe();
select diag((select json_agg(freeze_samples)::text from freeze_samples));
select is((select min(revision_delta) from freeze_samples),1901::bigint,'one revision per frozen line plus the existing final freeze revision');
select is((select min(item_audits) from freeze_samples),1900::bigint,'one unchanged item audit per frozen line');
select is((select min(version_steps) from freeze_samples),1901::bigint,'one consecutive version audit per line and final freeze revision');
select cmp_ok((select percentile_cont(.5) within group(order by ms)::numeric from freeze_samples),'<=',1000::numeric,'full workbook freeze median within native bulk budget');
select * from finish();
rollback;

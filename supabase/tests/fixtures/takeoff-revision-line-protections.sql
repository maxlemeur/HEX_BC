-- A last-part withdrawal consults the same source-line protections that a
-- redistribution shows. A movement-only blocker never prevents a withdrawal.
create function pg_temp.revision_protection(statement text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  begin
    perform set_config('miaouffrage.estimate_v3_writer',pg_temp.f(30)::text,true);
    execute statement;
    select jsonb_build_array(
      (select b->>'reason' from jsonb_array_elements(pg_temp.preview('together')->'blockers') b where b->>'line_id'=pg_temp.f(61)::text),
      (select b->>'reason' from jsonb_array_elements(private.takeoff_revision_line_protections(
        pg_temp.f(10),pg_temp.f(1),pg_temp.f(20),pg_temp.f(30),pg_temp.f(50),true)) b where b->>'line_id'=pg_temp.f(61)::text))
    into result;
    raise exception using errcode='Z0001';
  exception when sqlstate 'Z0001' then null; when others then result:=jsonb_build_object('error',sqlerrm);
  end;
  return result;
end;
$$;
select is(pg_temp.revision_protection(statement),jsonb_build_array(reason,reason),description)
from (values
  ('select 1',null::text,'a priced-default line with no member work can be withdrawn'),
  ('update public.estimate_items set quantity=7 where id=pg_temp.f(61)','quantity','a typed line quantity survives'),
  ('update public.estimate_items set unit_price_ht_cents=2300 where id=pg_temp.f(61)','edited','a manually priced line survives'),
  ('update public.estimate_items set title=''Lavabo changé'' where id=pg_temp.f(61)','edited','a renamed line survives'),
  ('insert into public.estimate_item_outlier_dismissals(tenant_id,version_id,item_id,flag_key,dismissed_by)
    values(pg_temp.f(10),pg_temp.f(30),pg_temp.f(61),''quantity_outlier'',pg_temp.f(1))','used','a line referenced elsewhere survives')
) as examples(statement,reason,description);

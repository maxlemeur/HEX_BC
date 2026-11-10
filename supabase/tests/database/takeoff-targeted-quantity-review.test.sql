begin;
select plan(6);

-- TI-681: recommendations never stand in for tenant/lock/OCC or technical protections.
select is(public.takeoff_item_rule_blocked('[{"status":"fail","code":"ZONE_OVERLAP_DUPLICATE","acceptable":true}]', false, false), false,
  'a suspected duplicate recommends review without requiring an acknowledgement');
select is(public.takeoff_item_rule_blocked('[{"status":"fail","code":"SCALE_DIMENSION_MISMATCH","acceptable":true}]', false, false), false,
  'uncertain scale is a quantity warning');
select is(public.takeoff_item_rule_blocked('[{"status":"fail","code":"NON_OBSERVABLE_TO_ENTER","acceptable":false}]', false, false), false,
  'a proposed non observable quantity remains a warning');
select is(public.takeoff_item_rule_blocked('[{"status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","acceptable":false}]', false, false), true,
  'blocked materials remain protected');
select is(public.takeoff_item_rule_blocked('[{"status":"fail","code":"UNKNOWN_FUTURE_RULE","acceptable":false}]', false, false), true,
  'unknown rules do not silently lose their protection');
select is(public.takeoff_item_rule_blocked('[]', true, false), true,
  'outdated results still need recalculation');

select * from finish();
rollback;

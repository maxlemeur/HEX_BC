begin;
select plan(6);

-- TI-684 (D14): an uncovered run of an overview is a quantity warning, as a duplicate between zones is (TI-681).
select is(public.takeoff_item_rule_blocked('[{"rule":"zone_coverage","status":"fail","code":"ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN","acceptable":true}]', false, false), false,
  'a run the enlarged plan does not draw recommends a review without blocking the application');
select is(public.takeoff_item_rule_blocked('[{"rule":"zone_coverage","status":"fail","code":"ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN","acceptable":true}]', true, false), true,
  'outdated results still need recalculation');
select is(public.takeoff_item_rule_blocked('[{"rule":"zone_coverage","status":"fail","code":"ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN","acceptable":true},{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","acceptable":false}]', false, true), true,
  'a blocked material beside it keeps its protection');
select is(public.takeoff_item_rule_blocked('[{"rule":"zone_coverage","status":"fail","code":"ZONE_COVERAGE_FUTURE_CODE","acceptable":false}]', false, false), true,
  'another code of the rule does not silently lose its protection');
select is(public.takeoff_item_rule_blocked('[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","acceptable":true},{"rule":"scale_dimension","status":"fail","code":"SCALE_DIMENSION_MISMATCH","acceptable":true}]', false, false), false,
  'the warnings listed before stay warnings');
-- The failure carries what a V accepted (the enlarged plans and the uncovered length): the keys read it as the TS twin does.
select is(public.takeoff_rule_failure_keys('[{"rule":"zone_coverage","status":"fail","code":"ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN","version":101,"acceptable":true,"details":{"level":"R+1","uncovered_m":6,"quantity_context_key":"0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef"}}]'),
  '["zone_coverage|ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN|101|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]'::jsonb,
  'a longer uncovered run or another enlarged plan is another failure key');

select * from finish();
rollback;

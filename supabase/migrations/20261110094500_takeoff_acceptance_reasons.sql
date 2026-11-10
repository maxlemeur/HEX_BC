-- TI-686 D9 (lot 2, M1). No remote application is authorized here.
-- Accepting (V) a scale or printed-area failure needs a coded reason and a note, as a network failure already does.
-- The justification stays additive: the flat network part ({reason_code, system_reference}) is unchanged, and each
-- new rule adds its own key ({scale_dimension: {reason_code, note}}, {area_printed: {reason_code, retained_basis,
-- note}}). No data is rewritten: rule versions 2 (scale) and 3 (printed area) reopen earlier V at the next computation.
-- The TS side (src/lib/takeoff/rules/verification.ts) refuses the same values first and prunes the reasons of the
-- failures a line no longer has; the reason lists below are provisional (H2) and kept equal to its lists.
comment on column public.takeoff_items.verification_justification is
  'Coded reason per rule of the current acceptance (network, scale, printed area); cleared when verification is withdrawn.';

-- From 20261107123425_takeoff_network_material_decisions.sql. Unchanged: withdrawing V clears the justification,
-- computations and the atomic apply pass, a written justification is its verifier's, stale results and failures V
-- never settles are refused. New:
-- - a written justification carries exactly the reasons of the failures the line has, none other;
-- - an update that does not write it (another user's attestation keeping V) never rewrites it: the reasons the line
--   needs must be there and valid, those of a failure that has since passed are kept (H22);
-- - a note is 10 to 500 code points once the ASCII blanks at its ends are removed (noteText on the TS side), written
--   inline: this trigger runs as authenticated, which cannot reach the private schema;
-- - a gas PE reason is refused on a pipe that is no gas PE (TAKEOFF_RULE_GAS_PE_REASON_NOT_APPLICABLE, H14);
-- - a printed surface declared on the price line's basis is comparable to the line: V then needs a quantity of at
--   least the printed surface, raised in an earlier request (TAKEOFF_RULE_AREA_QUANTITY_BELOW_PRINTED, D17 and H3).
create or replace function public.validate_takeoff_rule_acceptance()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
declare
  justification jsonb := new.verification_justification;
  network_reasons constant text[] := array['system_documented', 'gas_pe_buried_outside', 'gas_pe_facade_transition'];
  gas_pe_reasons constant text[] := array['gas_pe_buried_outside', 'gas_pe_facade_transition'];
  scale_reasons constant text[] := array['scale_confirmed_by_other_dimensions', 'dimension_not_to_scale',
    'quantity_from_dimensions', 'scale_confirmed_by_issuer'];
  area_reasons constant text[] := array['printed_area_basis_identified', 'measured_outline_retained',
    'confirmed_by_other_document', 'deviation_explained'];
  surface_bases constant text[] := array['net_floor', 'shab', 'other'];
  written boolean;
  needs_dn boolean;
  needs_scale boolean;
  needs_area boolean;
  gas_pe boolean;
  part jsonb;
begin
  if not new.is_verified then
    new.verification_justification := null;
    return new;
  end if;
  -- Computations only preserve a previous attestation or withdraw it; they cannot invent a user decision.
  if current_user <> 'authenticated'
    or coalesce(current_setting('app.takeoff_apply_atomic', true), '') = 'on' then return new; end if;
  written := new.verification_justification is distinct from old.verification_justification;
  if written and (new.verified_by is distinct from (select auth.uid()) or new.verified_at is null) then
    raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
  end if;
  if new.rules_stale then
    raise exception 'TAKEOFF_RULES_STALE' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.rule_results) r
    where r->>'status'='fail' and coalesce(r->>'acceptable','false') <> 'true') then
    raise exception 'TAKEOFF_RULE_NOT_ACCEPTABLE' using errcode = '23514';
  end if;

  -- What asks for a reason is the failure's code, never its cause (which the last storage bound drops).
  select coalesce(bool_or(r->>'rule' = 'dn_network'), false),
    coalesce(bool_or(r->>'code' = 'SCALE_DIMENSION_MISMATCH'), false),
    coalesce(bool_or(r->>'code' = 'AREA_PRINTED_MISMATCH'), false),
    coalesce(bool_or(r->>'code' = 'DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION'), false)
    into needs_dn, needs_scale, needs_area, gas_pe
  from jsonb_array_elements(new.rule_results) r
  where r->>'status' = 'fail';

  if not (needs_dn or needs_scale or needs_area) then
    -- No failure of the line asks for a reason: one written now is not kept, one kept from before is not rewritten.
    if written then new.verification_justification := null; end if;
    return new;
  end if;

  if jsonb_typeof(justification) is distinct from 'object' then
    raise exception 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_object_keys(justification) as key(name)
      where key.name <> all (array['reason_code', 'system_reference', 'scale_dimension', 'area_printed']))
    or (written and (
      (not needs_dn and (justification ? 'reason_code' or justification ? 'system_reference'))
      or (not needs_scale and justification ? 'scale_dimension')
      or (not needs_area and justification ? 'area_printed')))
  then
    raise exception 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED' using errcode = '23514';
  end if;

  if needs_dn then
    if jsonb_typeof(justification->'reason_code') is distinct from 'string'
      or jsonb_typeof(justification->'system_reference') is distinct from 'string'
      or (justification->>'reason_code') <> all (network_reasons)
      or char_length(regexp_replace(justification->>'system_reference', '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'))
        not between 10 and 500
    then
      raise exception 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED' using errcode = '23514';
    end if;
    if gas_pe and (justification->>'reason_code') <> all (gas_pe_reasons) then
      raise exception 'TAKEOFF_RULE_GAS_PE_REASON_REQUIRED' using errcode = '23514';
    end if;
    if not gas_pe and (justification->>'reason_code') = any (gas_pe_reasons) then
      raise exception 'TAKEOFF_RULE_GAS_PE_REASON_NOT_APPLICABLE' using errcode = '23514';
    end if;
  end if;

  if needs_scale then
    part := justification->'scale_dimension';
    if jsonb_typeof(part) is distinct from 'object' then
      raise exception 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_object_keys(part) as key(name) where key.name <> all (array['reason_code', 'note']))
      or jsonb_typeof(part->'reason_code') is distinct from 'string'
      or jsonb_typeof(part->'note') is distinct from 'string'
      or (part->>'reason_code') <> all (scale_reasons)
      or char_length(regexp_replace(part->>'note', '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')) not between 10 and 500
    then
      raise exception 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED' using errcode = '23514';
    end if;
  end if;

  if needs_area then
    part := justification->'area_printed';
    if jsonb_typeof(part) is distinct from 'object' then
      raise exception 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_object_keys(part) as key(name)
        where key.name <> all (array['reason_code', 'retained_basis', 'note']))
      or jsonb_typeof(part->'reason_code') is distinct from 'string'
      or jsonb_typeof(part->'retained_basis') is distinct from 'string'
      or jsonb_typeof(part->'note') is distinct from 'string'
      or (part->>'reason_code') <> all (area_reasons)
      or (part->>'retained_basis') <> all (surface_bases)
      or char_length(regexp_replace(part->>'note', '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')) not between 10 and 500
    then
      raise exception 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED' using errcode = '23514';
    end if;
    -- D17: on the price line's basis both surfaces compare and the higher is retained, to the thousandth (quantities
    -- are numeric(12,3)). The quantity is raised before V: a quantity changed in this request leaves the rules stale.
    if written and exists (select 1 from jsonb_array_elements(new.rule_results) r
      where r->>'status' = 'fail' and r->>'code' = 'AREA_PRINTED_MISMATCH'
        and r #>> '{details,expected_basis}' = part->>'retained_basis'
        and new.quantity < case when jsonb_typeof(r #> '{details,printed_m2}') = 'number'
          then (r #>> '{details,printed_m2}')::numeric - 0.0005 end)
    then
      raise exception 'TAKEOFF_RULE_AREA_QUANTITY_BELOW_PRINTED' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_takeoff_rule_acceptance() from public, anon, authenticated, service_role;

-- TI-682, lot C (D11, D25) : motif interne d'une exclusion. Une prestation nécessaire laissée « Non chiffrée » puis
-- classée avec un statut que le client lit (« Inclus », « Pour mémoire », « Hors lot », « Sans objet ») dit pourquoi,
-- en interne. Règles de la migration 20261111144803_estimate_line_status_reason.sql :
-- - estimate_items.status_reason (jsonb { code, note }) seulement sur ces quatre statuts, forme validée par
--   public.estimate_status_reason_valid ; écrit par commit_estimate_batch (clé de ligne, création et mise à jour) ;
-- - estimate_items.was_not_priced, collant, posé par le déclencheur seul (jamais une clé d'entrée) ;
-- - le motif s'efface quand le statut quitte les quatre statuts (effacer plutôt que refuser) ;
-- - les gardes v3 existantes interdisent l'écriture directe et gèlent la ligne hors brouillon ;
-- - une duplication de version recopie les deux colonnes.
-- Le contrôle d'envoi (excluded_without_reason) est en TypeScript : src/lib/estimates/gating.test.ts.
-- Isolation : le déclencheur, la contrainte, les gardes et la duplication ne s'observent pas depuis un parcours.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Sonde : exécute les instructions puis l'action, et annule toujours ses écritures.
create function pg_temp.sr_probe(p_statements text[], p_action text default null)
returns text
language plpgsql
as $probe$
declare
  probe_statement text;
  action_result text;
begin
  begin
    foreach probe_statement in array coalesce(p_statements, '{}'::text[]) loop
      execute probe_statement;
    end loop;
    if p_action is not null then
      execute p_action into action_result;
    end if;
    raise exception using errcode = 'P0001', message = 'SR_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm = 'SR_PROBE_ROLLBACK' then
      return 'ok' || coalesce(':' || action_result, '');
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$probe$;

-- ---------------------------------------------------------------------------
-- Structure.
-- ---------------------------------------------------------------------------
select col_type_is('public', 'estimate_items', 'status_reason', 'jsonb', 'the internal reason is a jsonb');
select col_is_null('public', 'estimate_items', 'status_reason', 'a line has no reason by default');
select col_type_is('public', 'estimate_items', 'was_not_priced', 'boolean', '« was not priced » is a boolean');
select col_not_null('public', 'estimate_items', 'was_not_priced', '« was not priced » is never null');
select col_default_is('public', 'estimate_items', 'was_not_priced', 'false', '« was not priced » defaults to false');
select is(
  (select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'estimate_status_reason_valid'),
  'i',
  'the validation of a reason is an immutable function (usable by the CHECK constraint)'
);

select is(
  array[
    public.estimate_status_reason_valid('{"code":"other_trade","note":null}'),
    public.estimate_status_reason_valid('{"code":"client_supplied","note":"  Fourni par le MOA  "}'),
    public.estimate_status_reason_valid('{"code":"included_elsewhere","note":null}'),
    public.estimate_status_reason_valid('{"code":"not_required_after_check","note":null}'),
    public.estimate_status_reason_valid('{"code":"dpgf_memory_item","note":null}'),
    public.estimate_status_reason_valid(jsonb_build_object('code', 'other', 'note', repeat('é', 500))),
    public.estimate_status_reason_valid('{"code":"other","note":null}'),
    public.estimate_status_reason_valid('{"code":"other","note":"   "}'),
    public.estimate_status_reason_valid('{"code":"other_trade","note":" 123456789 "}'),
    public.estimate_status_reason_valid(jsonb_build_object('code', 'other', 'note', repeat('é', 501))),
    public.estimate_status_reason_valid('{"code":"unknown","note":null}'),
    public.estimate_status_reason_valid('{"code":"other_trade"}'),
    public.estimate_status_reason_valid('{"code":"other_trade","note":null,"by":"x"}'),
    public.estimate_status_reason_valid('{"code":"other_trade","note":12345678901}'),
    public.estimate_status_reason_valid('"other_trade"'),
    public.estimate_status_reason_valid('{"code":null,"note":null}')
  ],
  array[true, true, true, true, true, true, false, false, false, false, false, false, false, false, false, false],
  'a reason is a code of the list and a note of 10 to 500 code points once trimmed, or null; « other » needs its note'
);

-- ---------------------------------------------------------------------------
-- Fixture : un ingénieur et son entreprise, une affaire, un utilisateur d'une autre entreprise.
--   ...8000-000000000001 ingénieur ; ...002 autre entreprise ; ...010 affaire ; versions ...110 v3 brouillon,
--   ...120 v3 envoyée. Lignes : « -8001- », même suffixe sans son dernier chiffre, puis le rang (0 = section).
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '68200000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'estimate-status-reason@example.test',
   crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '68200000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'estimate-status-reason-other@example.test',
   crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '68200000-0000-4000-8000-000000000001';
select set_config('test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '68200000-0000-4000-8000-000000000001' limit 1), true);
select isnt(
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '68200000-0000-4000-8000-000000000002' limit 1),
  current_setting('test.tenant_id'),
  'fixture: the second user belongs to another company'
);

insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('68200000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '68200000-0000-4000-8000-000000000001', 'Affaire motif interne');

select set_config('role', 'service_role', true);
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 3::smallint, p_default_sale_coefficient_fo => 1, p_default_sale_coefficient_mo => 1,
  p_allowed_tax_rates_bp => null, p_change_reason => 'TI-682 lot C', p_actor_user_id => '68200000-0000-4000-8000-000000000001');
select set_config('role', 'none', true);

create function pg_temp.sr_item(p_version uuid, p_index integer)
returns uuid
language sql
immutable
as $$
  select (left(replace(p_version::text, '-8000-', '-8001-'), 35) || p_index::text)::uuid
$$;

-- Une ligne v3 à 0 € (prix 0, aucune heure) : son montant est nul quel que soit son statut, et son PU vaut 0 chiffrée,
-- nul sinon. Le pied reste à 0 : chaque écriture passe D12 sans calcul.
create function pg_temp.sr_line(p_id uuid, p_parent uuid, p_position integer, p_title text, p_status text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', p_id, 'parent_id', p_parent, 'item_type', 'line', 'position', p_position,
    'title', p_title, 'quantity', 1, 'unit_price_ht_cents', 0, 'tax_rate_bp', 2000, 'k_fo', 1,
    'h_mo_per_unit', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'unit_code', 'u', 'pricing_status', p_status,
    'pu_ht_cents', case when p_status = 'priced' then 0 end, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
    'line_total_ttc_cents', 0)
$$;

create function pg_temp.sr_create(p_version uuid, p_items jsonb)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
    '68200000-0000-4000-8000-000000000001', '68200000-0000-4000-8000-000000000010', null,
    jsonb_build_object('id', p_version, 'title', 'Motif interne', 'date_devis', '2026-11-11', 'validite_jours', 30,
      'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
      'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
      'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
      'contractor_role', 'principal', 'calc_engine_version', 3, 'total_ht_cents', 0, 'total_tax_cents', 0,
      'total_ttc_cents', 0, 'sale_coefficient_fo', 1, 'sale_coefficient_mo', 1, 'gross_ht_cents', 0,
      'discount_applied_cents', 0, 'commercial_rounding_cents', 0),
    p_items, null);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;

-- L1, L4 « Non chiffrée » ; L2 « Pour mémoire » créée directement ; L3 chiffrée ; L5 « Hors lot » créée directement.
select is(
  pg_temp.sr_create('68200000-0000-4000-8000-000000000110', jsonb_build_array(
    jsonb_build_object('id', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 0), 'parent_id', null,
      'item_type', 'section', 'position', 1, 'title', 'Lot'),
    pg_temp.sr_line(pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 1),
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 0), 1, 'L1', 'not_priced'),
    pg_temp.sr_line(pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 2),
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 0), 2, 'L2', 'for_memory'),
    pg_temp.sr_line(pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 3),
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 0), 3, 'L3', 'priced'),
    pg_temp.sr_line(pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 4),
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 0), 4, 'L4', 'not_priced'),
    pg_temp.sr_line(pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 5),
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 0), 5, 'L5', 'out_of_scope')
  )),
  'ok',
  'fixture: a v3 draft at 0 € with two « Non chiffrée » lines and lines created with a status'
);

-- État des lignes d'une version : titre:statut:collant:motif, par titre.
create function pg_temp.sr_state(p_version uuid)
returns text
language sql
stable
as $$
  select string_agg(concat_ws(':', item.title, item.pricing_status, item.was_not_priced::text,
      coalesce(item.status_reason::text, '-')), ',' order by item.title collate "C")
  from public.estimate_items item
  where item.version_id = p_version and item.item_type = 'line'
$$;

select is(
  pg_temp.sr_state('68200000-0000-4000-8000-000000000110'),
  'L1:not_priced:true:-,L2:for_memory:false:-,L3:priced:false:-,L4:not_priced:true:-,L5:out_of_scope:false:-',
  'a line created « Non chiffrée » is « was not priced »; a line created priced or with another status is not'
);

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id) values
  ('68200000-0000-4000-8000-000000000110', '68200000-0000-4000-8000-000000000001',
   current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes',
   '68200000-0000-4000-8000-000000000403');

-- Lot de l'ingénieur sous son verrou : la projection de chaque ligne de la version après le lot (PU 0 chiffrée, nul
-- sinon ; montants nuls) et un pied nul. Rend ok, le code d'un lot refusé, ou l'erreur levée.
create function pg_temp.sr_batch(p_version uuid, p_operations jsonb, p_created_ids jsonb default '[]'::jsonb)
returns text
language plpgsql
as $$
declare
  updates jsonb;
  response jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', line.id,
      'pu_ht_cents', case when line.status = 'priced' then 0 end,
      'line_total_ht_cents', 0, 'line_tax_cents', 0, 'line_total_ttc_cents', 0) order by line.id), '[]'::jsonb)
    into updates
  from (
    select item.id, coalesce((
        select op -> 'data' ->> 'pricing_status' from jsonb_array_elements(p_operations) op
        where op ->> 'op' = 'update' and (op ->> 'id')::uuid = item.id and op -> 'data' ? 'pricing_status'
        order by 1 desc limit 1), item.pricing_status::text) as status
    from public.estimate_items item
    where item.version_id = p_version and item.item_type = 'line'
    union all
    select (created ->> 'id')::uuid, coalesce(p_operations -> (created ->> 'index')::integer -> 'data' ->> 'pricing_status', 'priced')
    from jsonb_array_elements(p_created_ids) created
    where p_operations -> (created ->> 'index')::integer -> 'data' ->> 'item_type' = 'line'
  ) line;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '68200000-0000-4000-8000-000000000001', true);
  response := public.commit_estimate_batch(p_version, gen_random_uuid(),
    (select updated_at from public.estimate_versions where id = p_version),
    '68200000-0000-4000-8000-000000000403', p_operations, p_created_ids, updates,
    '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"gross_ht_cents":0,"discount_applied_cents":0,"commercial_rounding_cents":0}'::jsonb,
    '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}'::jsonb, null);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if (response ->> 'committed')::boolean then return 'ok'; end if;
  return 'refused ' || coalesce((select result ->> 'code' from jsonb_array_elements(response -> 'results') result
    where result ->> 'status' = 'error' limit 1), '?');
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;

create function pg_temp.sr_update(p_index integer, p_data jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(jsonb_build_object('op', 'update',
    'id', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', p_index), 'data', p_data))
$$;

-- ---------------------------------------------------------------------------
-- Le statut change sans motif : admis ; « a été Non chiffrée » reste vrai, même en deux temps.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(1, '{"pricing_status":"out_of_scope"}')),
  'ok',
  'a « Non chiffrée » line classified « Hors lot » without a reason is admitted (the send waits, not the write)'
);
select is(
  pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(4, '{"pricing_status":"priced"}')),
  'ok',
  'a « Non chiffrée » line is priced'
);
select is(
  pg_temp.sr_batch('68200000-0000-4000-8000-000000000110',
    pg_temp.sr_update(4, '{"pricing_status":"out_of_scope"}') || pg_temp.sr_update(3, '{"pricing_status":"for_memory"}')),
  'ok',
  'the priced line is then classified « Hors lot », and a line always priced « Pour mémoire »'
);
select is(
  pg_temp.sr_state('68200000-0000-4000-8000-000000000110'),
  'L1:out_of_scope:true:-,L2:for_memory:false:-,L3:for_memory:false:-,L4:out_of_scope:true:-,L5:out_of_scope:false:-',
  '« was not priced » is sticky (not_priced → priced → out_of_scope keeps it); a line never « Non chiffrée » stays false'
);

-- ---------------------------------------------------------------------------
-- Le motif s'écrit par le lot, se garde entre les quatre statuts, s'efface quand la ligne les quitte.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.sr_batch('68200000-0000-4000-8000-000000000110',
    pg_temp.sr_update(1, '{"status_reason":{"code":"other_trade","note":"  Lot CVC du marché \n"}}')),
  'ok',
  'the batch writes a reason on an excluded line'
);
select is(
  (select status_reason::text from public.estimate_items where id = pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 1)),
  '{"code": "other_trade", "note": "Lot CVC du marché"}',
  'the reason is stored with its note trimmed'
);
select is(
  array[
    pg_temp.sr_probe(array[
      format('select pg_temp.sr_batch(%L, pg_temp.sr_update(1, %L))', '68200000-0000-4000-8000-000000000110',
        '{"pricing_status":"not_applicable"}')
    ], format('select status_reason->>%L from public.estimate_items where id = %L', 'code',
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 1))),
    pg_temp.sr_probe(array[
      format('select pg_temp.sr_batch(%L, pg_temp.sr_update(1, %L))', '68200000-0000-4000-8000-000000000110',
        '{"pricing_status":"priced"}')
    ], format('select concat_ws(%L, pricing_status, was_not_priced::text, (status_reason is null)::text) from public.estimate_items where id = %L',
      ':', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 1))),
    pg_temp.sr_probe(array[
      format('select pg_temp.sr_batch(%L, pg_temp.sr_update(1, %L))', '68200000-0000-4000-8000-000000000110',
        '{"pricing_status":"not_priced"}')
    ], format('select concat_ws(%L, pricing_status, was_not_priced::text, (status_reason is null)::text) from public.estimate_items where id = %L',
      ':', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 1))),
    pg_temp.sr_probe(array[
      format('select pg_temp.sr_batch(%L, pg_temp.sr_update(1, %L))', '68200000-0000-4000-8000-000000000110',
        '{"status_reason":null}')
    ], format('select status_reason is null from public.estimate_items where id = %L',
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 1)))
  ],
  array['ok:other_trade', 'ok:priced:true:true', 'ok:not_priced:true:true', 'ok:true'],
  'the reason stays between the four statuses, is cleared when the line is priced again or back to « Non chiffrée », and by null'
);

select is(
  pg_temp.sr_probe(array[
    format('select pg_temp.sr_batch(%L, %L::jsonb, %L::jsonb)', '68200000-0000-4000-8000-000000000110',
      jsonb_build_array(jsonb_build_object('op', 'create', 'data', jsonb_build_object('item_type', 'line',
        'parent_id', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 0), 'position', 9, 'title', 'L9',
        'quantity', 1, 'unit_price_ht_cents', 0, 'h_mo_per_unit', 0, 'unit_code', 'u', 'pricing_status', 'for_memory',
        'status_reason', jsonb_build_object('code', 'dpgf_memory_item', 'note', null)))),
      jsonb_build_array(jsonb_build_object('index', 0, 'id', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 9))))
  ], format('select concat_ws(%L, pricing_status, was_not_priced::text, status_reason->>%L) from public.estimate_items where id = %L',
    ':', 'code', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 9))),
  'ok:for_memory:false:dpgf_memory_item',
  'the batch creates a line with its status and reason; created excluded, it is not « was not priced »'
);

-- ---------------------------------------------------------------------------
-- Entrées refusées par le lot, avec un code stable ; rien n'est écrit.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(4, '{"status_reason":{"code":"unknown","note":null}}')),
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(4, '{"status_reason":{"code":"other_trade","note":" 123456789 "}}')),
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(4, '{"status_reason":{"code":"other","note":"  "}}')),
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(4, '{"status_reason":{"code":"other_trade","note":null,"by":"x"}}')),
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(4, '{"status_reason":"other_trade"}')),
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(4, '{"was_not_priced":false}')),
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110',
      jsonb_build_array(jsonb_build_object('op', 'create', 'data', jsonb_build_object('item_type', 'line',
        'title', 'L8', 'pricing_status', 'out_of_scope', 'was_not_priced', true))),
      jsonb_build_array(jsonb_build_object('index', 0, 'id', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 8)))),
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110',
      jsonb_build_array(jsonb_build_object('op', 'create', 'data', jsonb_build_object('item_type', 'section',
        'title', 'S8', 'status_reason', jsonb_build_object('code', 'other_trade', 'note', null)))),
      jsonb_build_array(jsonb_build_object('index', 0, 'id', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 8))))
  ],
  array_fill('22023 ESTIMATE_BATCH_INVALID_INPUT'::text, array[8]),
  'the batch refuses an unknown code, a 9-character note, « other » without note, an extra key, a non-object reason, '
    || '« was not priced » as an input (update and create) and a reason on a section, by a stable code'
);
select is(
  array[
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110',
      pg_temp.sr_update(3, '{"pricing_status":"priced","status_reason":{"code":"other_trade","note":null}}')),
    pg_temp.sr_batch('68200000-0000-4000-8000-000000000110',
      pg_temp.sr_update(4, '{"status_reason":{"code":"other_trade","note":null}}')
      || pg_temp.sr_update(1, '{"pricing_status":"priced","status_reason":{"code":"included_elsewhere","note":null}}'))
  ],
  array['refused ESTIMATE_BATCH_INVALID_INPUT', 'refused ESTIMATE_BATCH_INVALID_INPUT'],
  'a new reason written with a priced status is refused by the CHECK constraint, and the whole batch is rolled back'
);
select is(
  pg_temp.sr_state('68200000-0000-4000-8000-000000000110'),
  'L1:out_of_scope:true:{"code": "other_trade", "note": "Lot CVC du marché"},L2:for_memory:false:-,L3:for_memory:false:-,L4:out_of_scope:true:-,L5:out_of_scope:false:-',
  'nothing refused was written'
);

-- ---------------------------------------------------------------------------
-- Écriture directe (API de données) et contrat d'écrivain.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.sr_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68200000-0000-4000-8000-000000000001', true)$s$,
      format($s$update public.estimate_items set status_reason = '{"code":"other_trade","note":null}' where id = %L$s$,
        pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 4))
    ]),
    pg_temp.sr_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68200000-0000-4000-8000-000000000001', true)$s$,
      format('update public.estimate_items set was_not_priced = false where id = %L',
        pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 4))
    ]),
    pg_temp.sr_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68200000-0000-4000-8000-000000000001', true)$s$,
      format('update public.estimate_items set was_not_priced = true where id = %L',
        pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 3))
    ])
  ],
  array_fill('0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED'::text, array[3]),
  'on a v3 draft, the Data API writes neither the reason nor « was not priced »'
);

create function pg_temp.sr_writer(p_statement text, p_index integer)
returns text
language sql
as $$
  select pg_temp.sr_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '68200000-0000-4000-8000-000000000110', true)$s$,
      p_statement
    ],
    format('select concat_ws(%L, pricing_status, was_not_priced::text, coalesce(status_reason->>%L, %L)) from public.estimate_items where id = %L',
      ':', 'code', '-', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', p_index))
  )
$$;

select is(
  array[
    pg_temp.sr_writer(format($s$update public.estimate_items set status_reason = '{"code":"other_trade","note":null}' where id = %L$s$,
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 2)), 2),
    pg_temp.sr_writer(format($s$update public.estimate_items set pricing_status = 'priced', status_reason = '{"code":"included_elsewhere","note":null}' where id = %L$s$,
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 1)), 1),
    pg_temp.sr_writer(format('update public.estimate_items set was_not_priced = false where id = %L',
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 4)), 4),
    pg_temp.sr_writer(format('update public.estimate_items set was_not_priced = true where id = %L',
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 3)), 3),
    pg_temp.sr_writer(format($s$insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position,
        title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code, pricing_status,
        h_mo_per_unit, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, status_reason)
      select %L, tenant_id, id, %L, 'line', 7, 'L7', 1, 0, 2000, 1, 1, 1, 'u', 'priced', 0, 0, 0, 0, 0,
        '{"code":"other_trade","note":null}'
      from public.estimate_versions where id = '68200000-0000-4000-8000-000000000110'$s$,
      pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 7), pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 0)), 7)
  ],
  array[
    'ok:for_memory:false:other_trade',
    '23514 new row for relation "estimate_items" violates check constraint "estimate_items_status_reason_check"',
    'ok:out_of_scope:true:-',
    'ok:for_memory:false:-',
    '23514 new row for relation "estimate_items" violates check constraint "estimate_items_status_reason_check"'
  ],
  'under the writer contract: a reason only on the four statuses (CHECK), and « was not priced » is the trigger''s alone'
);

-- ---------------------------------------------------------------------------
-- Une ligne « Non chiffrée » d'avant la migration (indicateur faux) le devient à son premier changement de statut.
-- Les clés parentes différées en attente sont vérifiées avant chaque modification de la table (ALTER TABLE).
-- ---------------------------------------------------------------------------
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items disable trigger ae_track_estimate_item_status_reason;
select set_config('miaouffrage.estimate_v3_writer', '68200000-0000-4000-8000-000000000110', true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code, pricing_status, h_mo_per_unit, pu_ht_cents,
  line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
select pg_temp.sr_item(id, 6), tenant_id, id, pg_temp.sr_item(id, 0), 'line', 6, 'L6', 1, 0, 2000, 1, 1, 1, 'u', 'not_priced',
  0, null, 0, 0, 0
from public.estimate_versions where id = '68200000-0000-4000-8000-000000000110';
select set_config('miaouffrage.estimate_v3_writer', '', true);
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items enable trigger ae_track_estimate_item_status_reason;

select is(
  array[
    (select was_not_priced::text from public.estimate_items where id = pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 6)),
    pg_temp.sr_probe(array[
      format('select pg_temp.sr_batch(%L, pg_temp.sr_update(6, %L))', '68200000-0000-4000-8000-000000000110', '{"title":"L6 renommée"}')
    ], format('select was_not_priced from public.estimate_items where id = %L', pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 6)))
  ],
  array['false', 'ok:false'],
  'a line « Non chiffrée » before the migration is not « was not priced » before a status change (a rename changes nothing)'
);
-- Write and read in two statements: a statement reads the snapshot it started with.
select is(
  pg_temp.sr_batch('68200000-0000-4000-8000-000000000110', pg_temp.sr_update(6, '{"pricing_status":"included"}')),
  'ok',
  'that line is classified « Inclus »'
);
select is(
  (select concat_ws(':', pricing_status, was_not_priced::text) from public.estimate_items
   where id = pg_temp.sr_item('68200000-0000-4000-8000-000000000110', 6)),
  'included:true',
  'its first status change makes it « was not priced »'
);

-- ---------------------------------------------------------------------------
-- Version envoyée : rien ne change, ni par l'écrivain ni par le déclencheur.
-- ---------------------------------------------------------------------------
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, title,
  sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents)
values ('68200000-0000-4000-8000-000000000120', current_setting('test.tenant_id')::uuid,
  '68200000-0000-4000-8000-000000000010', 2, 'sent', 3, 'Motif interne envoyée', 1, 1, 0, 0, 0);
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items disable trigger bump_estimate_content_revision_from_item;
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items disable trigger ae_track_estimate_item_status_reason;
select set_config('miaouffrage.estimate_v3_writer', '68200000-0000-4000-8000-000000000120', true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values (pg_temp.sr_item('68200000-0000-4000-8000-000000000120', 0), current_setting('test.tenant_id')::uuid,
  '68200000-0000-4000-8000-000000000120', null, 'section', 1, 'Lot envoyé');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code, pricing_status, h_mo_per_unit, pu_ht_cents,
  line_total_ht_cents, line_tax_cents, line_total_ttc_cents, was_not_priced, status_reason)
select pg_temp.sr_item(version.id, entry.position), version.tenant_id, version.id, pg_temp.sr_item(version.id, 0), 'line', entry.position, entry.title,
  1, 0, 2000, 1, 1, 1, 'u', entry.status::public.estimate_line_pricing_status, 0, null, 0, 0, 0, entry.was_not_priced, entry.reason
from public.estimate_versions version
cross join (values
  (1, 'E1', 'out_of_scope', true, '{"code":"client_supplied","note":null}'::jsonb),
  (2, 'E2', 'not_priced', false, null::jsonb)
) as entry(position, title, status, was_not_priced, reason)
where version.id = '68200000-0000-4000-8000-000000000120';
select set_config('miaouffrage.estimate_v3_writer', '', true);
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items enable trigger ae_track_estimate_item_status_reason;
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items enable trigger bump_estimate_content_revision_from_item;

create function pg_temp.sr_sent(p_statement text)
returns text
language sql
as $$
  select pg_temp.sr_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '68200000-0000-4000-8000-000000000120', true)$s$,
      p_statement
    ],
    $a$select pg_temp.sr_state('68200000-0000-4000-8000-000000000120')$a$
  )
$$;

select is(
  array[
    pg_temp.sr_sent(format($s$update public.estimate_items set status_reason = '{"code":"other_trade","note":null}' where id = %L$s$,
      pg_temp.sr_item('68200000-0000-4000-8000-000000000120', 1))),
    pg_temp.sr_sent(format('update public.estimate_items set status_reason = null where id = %L',
      pg_temp.sr_item('68200000-0000-4000-8000-000000000120', 1))),
    pg_temp.sr_sent(format('update public.estimate_items set was_not_priced = true where id = %L',
      pg_temp.sr_item('68200000-0000-4000-8000-000000000120', 2))),
    pg_temp.sr_sent(format('update public.estimate_items set title = title where version_id = %L',
      '68200000-0000-4000-8000-000000000120'))
  ],
  array[
    '42501 ESTIMATE_VERSION_READ_ONLY',
    '42501 ESTIMATE_VERSION_READ_ONLY',
    '42501 ESTIMATE_VERSION_READ_ONLY',
    'ok:E1:out_of_scope:true:{"code": "client_supplied", "note": null},E2:not_priced:false:-'
  ],
  'a sent v3 keeps its reasons and flags: refused when written, and an unchanged write changes nothing'
);

-- ---------------------------------------------------------------------------
-- Duplication : les deux colonnes suivent chaque ligne.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.sr_probe(
    array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68200000-0000-4000-8000-000000000001', true)$s$,
      $s$select set_config('sr_test.duplicate_id',
         public.duplicate_estimate_version('68200000-0000-4000-8000-000000000110', false)::text, true)$s$,
      'reset role'
    ],
    $a$select (pg_temp.sr_state(current_setting('sr_test.duplicate_id')::uuid) = pg_temp.sr_state('68200000-0000-4000-8000-000000000110'))::text
       || '|' || pg_temp.sr_state(current_setting('sr_test.duplicate_id')::uuid)$a$
  ),
  'ok:true|L1:out_of_scope:true:{"code": "other_trade", "note": "Lot CVC du marché"},L2:for_memory:false:-,L3:for_memory:false:-,'
    || 'L4:out_of_scope:true:-,L5:out_of_scope:false:-,L6:included:true:-',
  'a duplicated version copies the reason and « was not priced » of each line'
);

-- ---------------------------------------------------------------------------
-- TI-539 et TI-682 redéfinissent les mêmes fonctions (lot canonique, duplication) depuis le même corps : la seconde
-- migration doit garder l'apport de la première. Un seul lot écrit la nature « POSE SEULE » et un motif sur la même
-- ligne, et la copie de version garde les deux.
-- ---------------------------------------------------------------------------
select is(
  private.canonical_estimate_batch_operations(pg_temp.sr_update(1,
    '{"line_nature":"pose_only","status_reason":{"code":"client_supplied","note":" Fourni par le client "}}')) #>> '{0,data}',
  '{"line_nature": "pose_only", "status_reason": {"code": "client_supplied", "note": "Fourni par le client"}}',
  'the canonical batch keeps a POSE SEULE nature and a reason carried by the same operation'
);
select is(
  pg_temp.sr_probe(
    array[
      format('select pg_temp.sr_batch(%L, pg_temp.sr_update(1, %L))', '68200000-0000-4000-8000-000000000110',
        '{"line_nature":"pose_only","status_reason":{"code":"client_supplied","note":null}}'),
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68200000-0000-4000-8000-000000000001', true)$s$,
      $s$select set_config('sr_test.duplicate_id',
         public.duplicate_estimate_version('68200000-0000-4000-8000-000000000110', false)::text, true)$s$,
      'reset role'
    ],
    $a$select string_agg(concat_ws(':', item.line_nature, item.pricing_status, item.was_not_priced::text,
           item.status_reason->>'code'), '|' order by (item.version_id = '68200000-0000-4000-8000-000000000110') desc)
       from public.estimate_items item
       where item.title = 'L1' and item.version_id in ('68200000-0000-4000-8000-000000000110',
         current_setting('sr_test.duplicate_id')::uuid)$a$
  ),
  'ok:pose_only:out_of_scope:true:client_supplied|pose_only:out_of_scope:true:client_supplied',
  'one batch writes POSE SEULE and a reason on a line, and a duplicated version keeps both on its copy'
);

-- ---------------------------------------------------------------------------
-- RLS : une autre entreprise ne lit ni la ligne ni son motif.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.sr_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68200000-0000-4000-8000-000000000002', true)$s$
    ], $a$select count(*)::text from public.estimate_items where version_id = '68200000-0000-4000-8000-000000000110' and status_reason is not null$a$),
    pg_temp.sr_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68200000-0000-4000-8000-000000000001', true)$s$
    ], $a$select count(*)::text from public.estimate_items where version_id = '68200000-0000-4000-8000-000000000110' and status_reason is not null$a$)
  ],
  array['ok:0', 'ok:1'],
  'another company reads no line and no reason; the company itself reads its own'
);

select * from finish();
rollback;

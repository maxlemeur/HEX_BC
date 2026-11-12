-- TI-682, lot C, PR 5 : la mention « quantité provisionnelle ». Une ligne chiffrée dont la quantité repose sur une
-- hypothèse du métré peut partir chez le client si l'offre le dit : un administrateur déclare sur la ligne ce sur quoi la
-- quantité est établie et ce qui la confirmera ; l'outil compose la phrase d'après la ligne actuelle
-- (src/lib/estimates/provisional-quantity.ts) et le contrôle d'envoi (TypeScript, moteur 3,
-- provisional_quantity_mention_missing, ni rétrogradable ni forçable) exige qu'elle figure dans le texte « Précisions et
-- limites de prestation ». La ligne reste une ligne chiffrée ordinaire : aucun contrat client, aucune charge de sceau,
-- aucun montant ne change.
--
-- - public.estimate_offer_choice_valid admet le kind « provisional_quantity » : { kind, basis, note, established_on,
--   to_confirm_by, decided_by, decided_at } sur une ligne « priced ». La base et la note sont celles d'une réserve (même
--   question de régularité en marché public) ; pas de code (la cause de l'hypothèse est dans le marqueur, ce qui confirme
--   la quantité dans to_confirm_by). La réserve est inchangée. La contrainte estimate_items_offer_choice_check n'est pas
--   touchée : elle appelle cette fonction, et un choix déjà stocké reste valide (la fonction n'admet que davantage).
-- - public.estimate_item_takeoff_hypothesis : jumelle de readTakeoffProvision (src/lib/estimates/takeoff-provision.ts),
--   vrai pour un marqueur lisible dont une source repose sur une hypothèse.
-- - public.set_estimate_line_offer_choice : mêmes contrôles (service_role, administrateur actif, v3 brouillon, jeton,
--   verrou) ; la quantité provisionnelle exige le marqueur d'hypothèse (ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED) ; ses
--   deux textes sont réduits à une ligne avant d'être validés.
-- - private.clear_estimate_item_offer_choice / af_clear_estimate_item_offer_choice : la quantité provisionnelle s'efface
--   quand la ligne quitte « priced » (comme la réserve quitte « Non chiffrée ») ou perd son marqueur d'hypothèse ; un
--   écrivain autre que la déclaration ne peut la poser ni hors moteur 3 ni sans marqueur. Une insertion n'en porte
--   jamais : la duplication de version, la copie de section et les modèles n'en recopient aucune.
-- - Inchangés : private.record_estimate_offer_choices_on_sent (l'événement « sent » recopie le choix entier, textes
--   compris), commit_estimate_batch, private.canonical_estimate_batch_operations, la duplication de version, la sélection
--   des sources du métré.
-- Additive : aucune ligne réécrite, aucune colonne ajoutée. À appliquer avant le code qui déclare ce kind ; le code
-- antérieur l'ignore (il ne lit qu'une réserve), et ce code-ci sans la migration voit la déclaration refusée par la base.
begin;

-- Jumelle de readTakeoffProvision : vrai pour un marqueur version 1 lisible (job_id texte, sources non vides, chaque
-- source un objet de la forme du schéma zod) dont une source repose sur une hypothèse (saisie « hypothesis », forcée
-- comme hypothèse chiffrée, ou une cause d'hypothèse). Un marqueur illisible est une provision interne, jamais une
-- hypothèse. Pure ; les CASE gardent la lecture des sources d'un marqueur qui n'en a pas.
create function public.estimate_item_takeoff_hypothesis(p_source_metadata jsonb)
returns boolean
language sql immutable parallel safe set search_path = '' as $hypothesis$
  select coalesce((
    select case
      when pg_catalog.jsonb_typeof(provision.marker) = 'object'
        and pg_catalog.jsonb_typeof(provision.marker -> 'version') = 'number'
        and provision.marker -> 'version' = '1'::jsonb
        and pg_catalog.jsonb_typeof(provision.marker -> 'job_id') = 'string'
        and pg_catalog.jsonb_typeof(provision.marker -> 'sources') = 'array'
      then pg_catalog.jsonb_array_length(provision.marker -> 'sources') > 0
        and not exists (
          select 1 from pg_catalog.jsonb_array_elements(provision.marker -> 'sources') as source(value)
          where not coalesce(pg_catalog.jsonb_typeof(source.value) = 'object'
            and pg_catalog.jsonb_typeof(source.value -> 'takeoff_item_id') = 'string'
            and pg_catalog.jsonb_typeof(source.value -> 'forced') = 'boolean'
            and pg_catalog.jsonb_typeof(source.value -> 'forced_reason') in ('string', 'null')
            and pg_catalog.jsonb_typeof(source.value -> 'entry_category') in ('string', 'null')
            and coalesce(pg_catalog.jsonb_typeof(source.value -> 'hypothesis_cause'), 'null') in ('string', 'null'), false))
        and exists (
          select 1 from pg_catalog.jsonb_array_elements(provision.marker -> 'sources') as source(value)
          where source.value ->> 'entry_category' = 'hypothesis'
            or source.value ->> 'forced_reason' = 'priced_hypothesis'
            or pg_catalog.jsonb_typeof(source.value -> 'hypothesis_cause') = 'string')
      else false
    end
    from (select p_source_metadata -> 'takeoff_provision' as marker) as provision
  ), false)
$hypothesis$;
revoke all on function public.estimate_item_takeoff_hypothesis(jsonb) from public, anon, authenticated, service_role;
-- Pure : ni lecture ni écriture. Le déclencheur l'appelle sous le rôle de l'écrivain.
grant execute on function public.estimate_item_takeoff_hypothesis(jsonb) to authenticated, service_role;
comment on function public.estimate_item_takeoff_hypothesis(jsonb) is
  'TI-682: whether an estimate line''s takeoff marker (source_metadata.takeoff_provision) is readable and rests on a hypothesis; SQL twin of readTakeoffProvision (kind hypothesis).';

-- Latest definition: 20261111193950_estimate_line_offer_choice.sql. Changed: the key set and the code move into the
-- « reserve » branch (unchanged there), the « provisional_quantity » branch, and the note rule reads a missing code as
-- none (coalesce).
create or replace function public.estimate_offer_choice_valid(p_choice jsonb, p_status public.estimate_line_pricing_status)
returns boolean
language sql immutable set search_path = '' as $valid$
  select coalesce(
    pg_catalog.jsonb_typeof(p_choice) = 'object'
    and pg_catalog.jsonb_typeof(p_choice -> 'kind') = 'string'
    and pg_catalog.jsonb_typeof(p_choice -> 'basis') = 'string'
    and case p_choice ->> 'kind'
      when 'reserve' then p_choice ?& array['kind', 'basis', 'code', 'note', 'decided_by', 'decided_at']
        and p_choice - array['kind', 'basis', 'code', 'note', 'decided_by', 'decided_at'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(p_choice -> 'code') = 'string'
        and p_status = 'not_priced'::public.estimate_line_pricing_status
        and p_choice ->> 'basis' in ('private_estimate', 'indicative_quantities')
        and p_choice ->> 'code' in ('quantity_not_determinable', 'pending_survey', 'pending_buyer_answer', 'other')
      -- TI-682, lot C, PR 5 : une ligne chiffrée, sans code ; ce sur quoi la quantité est établie et ce qui la confirmera,
      -- imprimés dans la phrase que lit le client : une ligne de 3 à 160 caractères, sans blanc doublé ni en bout, sans
      -- caractère de contrôle, invisible ou séparateur (la classe ci-dessous est celle de \p{Cc}, \p{Cf}, \p{Zl}, \p{Zp} et
      -- des blancs autres que l'espace en Unicode 17, src/lib/estimates/provisional-quantity.ts).
      when 'provisional_quantity' then p_choice ?& array['kind', 'basis', 'note', 'established_on', 'to_confirm_by', 'decided_by', 'decided_at']
        and p_choice - array['kind', 'basis', 'note', 'established_on', 'to_confirm_by', 'decided_by', 'decided_at'] = '{}'::jsonb
        and p_status = 'priced'::public.estimate_line_pricing_status
        and p_choice ->> 'basis' in ('private_estimate', 'indicative_quantities')
        and pg_catalog.jsonb_typeof(p_choice -> 'established_on') = 'string'
        and pg_catalog.jsonb_typeof(p_choice -> 'to_confirm_by') = 'string'
        and pg_catalog.char_length(p_choice ->> 'established_on') between 3 and 160
        and pg_catalog.char_length(p_choice ->> 'to_confirm_by') between 3 and 160
        and (p_choice ->> 'established_on') !~ '^ | $|  |[\u0001-\u001f\u007f-\u00a0\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
        and (p_choice ->> 'to_confirm_by') !~ '^ | $|  |[\u0001-\u001f\u007f-\u00a0\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
      else false
    end
    and pg_catalog.jsonb_typeof(p_choice -> 'note') in ('string', 'null')
    and case
      when p_choice -> 'note' = 'null'::jsonb then coalesce(p_choice ->> 'code', '') <> 'other'
        and p_choice ->> 'basis' <> 'indicative_quantities'
      else pg_catalog.char_length(pg_catalog.regexp_replace(p_choice ->> 'note', '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'))
        between 10 and 500
    end
    and pg_catalog.jsonb_typeof(p_choice -> 'decided_by') = 'string'
    and p_choice ->> 'decided_by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and pg_catalog.jsonb_typeof(p_choice -> 'decided_at') = 'string'
    and p_choice ->> 'decided_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:[0-9]{2})?)$',
    false)
$valid$;
revoke all on function public.estimate_offer_choice_valid(jsonb, public.estimate_line_pricing_status)
  from public, anon, authenticated, service_role;
-- Pure : ni lecture ni écriture. La contrainte CHECK et le déclencheur l'appellent sous le rôle de l'écrivain.
grant execute on function public.estimate_offer_choice_valid(jsonb, public.estimate_line_pricing_status)
  to authenticated, service_role;
comment on function public.estimate_offer_choice_valid(jsonb, public.estimate_line_pricing_status) is
  'TI-682: shape of estimate_items.offer_choice and the line status it fits (reserve: not_priced; provisional_quantity: priced, its hypothesis marker checked by private.clear_estimate_item_offer_choice); codes provisional, kept equal to src/lib/estimates/offer-choice.ts.';

-- Latest definition: 20261111193950_estimate_line_offer_choice.sql. Changed: the « provisional_quantity » branch and the
-- trigger's columns (source_metadata, offer_choice).
create or replace function private.clear_estimate_item_offer_choice()
returns trigger language plpgsql set search_path = '' as $clear$
begin
  if tg_op = 'INSERT' then
    new.offer_choice := null;
  elsif new.offer_choice is not null
    and new.pricing_status is distinct from old.pricing_status
    and new.offer_choice is not distinct from old.offer_choice
    and not public.estimate_offer_choice_valid(new.offer_choice, new.pricing_status)
  then
    new.offer_choice := null;
  -- TI-682, lot C, PR 5 : une quantité provisionnelle inchangée s'efface quand sa ligne perd son marqueur d'hypothèse (une
  -- remesure dont les sources n'en sont plus, private.takeoff_mark_provisions) ; posée par un autre écrivain que la
  -- déclaration, elle est refusée hors moteur 3 ou sans ce marqueur. La lecture du moteur n'a lieu que sur ce chemin rare.
  elsif new.offer_choice is not null and new.offer_choice ->> 'kind' = 'provisional_quantity' then
    if new.offer_choice is not distinct from old.offer_choice then
      if new.source_metadata is distinct from old.source_metadata
        and not public.estimate_item_takeoff_hypothesis(new.source_metadata)
      then
        new.offer_choice := null;
      end if;
    elsif (select version.calc_engine_version from public.estimate_versions version where version.id = new.version_id)
      is distinct from 3
    then
      raise exception using errcode = '0A000', message = 'ESTIMATE_OFFER_CHOICE_ENGINE_NOT_SUPPORTED';
    elsif not public.estimate_item_takeoff_hypothesis(new.source_metadata) then
      raise exception using errcode = '23514', message = 'ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED';
    end if;
  end if;
  return new;
end;
$clear$;
revoke all on function private.clear_estimate_item_offer_choice() from public, anon, authenticated, service_role;
-- Même nom, même rang (après aay_ et aaz_) ; il suit aussi source_metadata (le marqueur) et offer_choice (un écrivain de
-- confiance autre que la déclaration).
drop trigger af_clear_estimate_item_offer_choice on public.estimate_items;
create trigger af_clear_estimate_item_offer_choice
  before insert or update of pricing_status, source_metadata, offer_choice on public.estimate_items
  for each row execute function private.clear_estimate_item_offer_choice();

-- Latest definition: 20261111193950_estimate_line_offer_choice.sql. Changed: the accepted keys (code no longer required
-- by itself, established_on and to_confirm_by allowed), the choice built from the given keys, the two texts reduced to one
-- line, the status of « provisional_quantity », and its hypothesis marker.
create or replace function public.set_estimate_line_offer_choice(
  p_tenant_id uuid, p_version_id uuid, p_item_id uuid, p_actor_user_id uuid, p_choice jsonb,
  p_expected_updated_at timestamptz, p_draft_lock_session_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $set$
declare
  version_row public.estimate_versions%rowtype;
  item_row public.estimate_items%rowtype;
  lock_row public.draft_locks%rowtype;
  choice jsonb;
  note text;
  text_key text;
  previous_writer text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_tenant_id is null or p_version_id is null or p_item_id is null or p_actor_user_id is null
    or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_CHOICE_INVALID_INPUT';
  end if;
  -- Administrateur d'une entreprise active, version de cette entreprise, affaire non archivée ; adhésion et entreprise
  -- tenues jusqu'à la fin de la transaction.
  perform tenant.id
  from public.tenants tenant
  join public.tenant_memberships membership on membership.tenant_id = tenant.id
  join public.estimate_versions version on version.tenant_id = tenant.id
  join public.estimate_projects project on project.id = version.project_id and project.tenant_id = tenant.id
  where tenant.id = p_tenant_id and tenant.is_active and membership.user_id = p_actor_user_id
    and membership.role = 'admin'::public.tenant_role and version.id = p_version_id and not project.is_archived
  for share of tenant, membership;
  if not found then
    raise exception using errcode = '42501', message = 'ESTIMATE_OFFER_CHOICE_FORBIDDEN';
  end if;
  select version.* into version_row from public.estimate_versions version
  where version.id = p_version_id and version.tenant_id = p_tenant_id for update;
  if version_row.status <> 'draft'::public.estimate_status then
    raise exception using errcode = '42501', message = 'ESTIMATE_VERSION_READ_ONLY';
  end if;
  if version_row.calc_engine_version is distinct from 3 then
    raise exception using errcode = '0A000', message = 'ESTIMATE_OFFER_CHOICE_ENGINE_NOT_SUPPORTED';
  end if;
  if version_row.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ESTIMATE_OFFER_CHOICE_STALE';
  end if;
  select draft_lock.* into lock_row from public.draft_locks draft_lock
  where draft_lock.version_id = p_version_id and draft_lock.tenant_id = p_tenant_id for share;
  if not found or p_draft_lock_session_id is null or lock_row.user_id is distinct from p_actor_user_id
    or lock_row.session_id is distinct from p_draft_lock_session_id or lock_row.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000', message = 'ESTIMATE_OFFER_CHOICE_LOCK_REQUIRED';
  end if;
  select item.* into item_row from public.estimate_items item
  where item.id = p_item_id and item.version_id = p_version_id and item.tenant_id = p_tenant_id for update;
  if not found or item_row.item_type <> 'line'::public.estimate_item_type then
    raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_CHOICE_LINE_REQUIRED';
  end if;

  if p_choice is null or p_choice = 'null'::jsonb then
    choice := null;
  else
    if pg_catalog.jsonb_typeof(p_choice) is distinct from 'object'
      or not (p_choice ?& array['kind', 'basis'])
      or p_choice - array['kind', 'basis', 'code', 'note', 'established_on', 'to_confirm_by'] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(p_choice -> 'note') not in ('string', 'null')
    then
      raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_CHOICE_INVALID';
    end if;
    note := nullif(pg_catalog.regexp_replace(coalesce(p_choice ->> 'note', ''), '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'), '');
    -- Les clés données (la forme exacte de chaque kind est celle de estimate_offer_choice_valid), la note rognée, l'auteur
    -- et l'heure de la base.
    choice := p_choice || pg_catalog.jsonb_build_object('note', coalesce(pg_catalog.to_jsonb(note), 'null'::jsonb),
      'decided_by', p_actor_user_id, 'decided_at', pg_catalog.to_jsonb(pg_catalog.statement_timestamp()));
    -- TI-682, lot C, PR 5 : les textes de la phrase sur une ligne, comme normalizeProvisionalText (le \s de JavaScript).
    foreach text_key in array array['established_on', 'to_confirm_by'] loop
      if pg_catalog.jsonb_typeof(choice -> text_key) = 'string' then
        choice := pg_catalog.jsonb_set(choice, array[text_key], pg_catalog.to_jsonb(pg_catalog.btrim(
          pg_catalog.regexp_replace(choice ->> text_key, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ')));
      end if;
    end loop;
    -- La forme d'abord, contre le statut qui convient à ce kind ; puis le statut de la ligne.
    if not public.estimate_offer_choice_valid(choice, case p_choice ->> 'kind'
      when 'reserve' then 'not_priced'::public.estimate_line_pricing_status
      when 'provisional_quantity' then 'priced'::public.estimate_line_pricing_status end) then
      raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_CHOICE_INVALID';
    end if;
    if not public.estimate_offer_choice_valid(choice, item_row.pricing_status) then
      raise exception using errcode = '23514', message = 'ESTIMATE_OFFER_CHOICE_STATUS_MISMATCH';
    end if;
    -- Une quantité provisionnelle repose sur une hypothèse du métré : le marqueur que readTakeoffProvision lit.
    if choice ->> 'kind' = 'provisional_quantity' and not public.estimate_item_takeoff_hypothesis(item_row.source_metadata) then
      raise exception using errcode = '23514', message = 'ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED';
    end if;
  end if;

  previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', p_version_id::text, true);
  update public.estimate_items item set offer_choice = choice
  where item.id = p_item_id and item.version_id = p_version_id
  returning item.* into item_row;
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);

  select version.* into version_row from public.estimate_versions version where version.id = p_version_id;
  return pg_catalog.jsonb_build_object(
    'item', pg_catalog.jsonb_build_object('id', item_row.id, 'version_id', item_row.version_id,
      'pricing_status', item_row.pricing_status, 'offer_choice', item_row.offer_choice),
    'version', pg_catalog.jsonb_build_object('id', version_row.id, 'updated_at', version_row.updated_at,
      'content_revision', version_row.content_revision));
end;
$set$;
revoke all on function public.set_estimate_line_offer_choice(uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.set_estimate_line_offer_choice(uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid)
  to service_role;
comment on function public.set_estimate_line_offer_choice(uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid) is
  'TI-682: declares (or withdraws, null) the written reserve of a « Non chiffrée » line, or the provisional quantity of a priced line resting on a takeoff hypothesis, of a v3 draft. Server only, for an administrator of an active company holding the draft lock, at the version token.';

comment on column public.estimate_items.offer_choice is
  'TI-682: written reserve of a « Non chiffrée » line ({kind: reserve, basis, code, note, decided_by, decided_at}) or provisional quantity of a priced line whose quantity rests on a takeoff hypothesis ({kind: provisional_quantity, basis, note, established_on, to_confirm_by, decided_by, decided_at}), declared by a tenant administrator through public.set_estimate_line_offer_choice only. Internal: never in the client contract, the seal, the PDF or the portal (the client reads the limits text). Cleared when the status or the hypothesis marker no longer fits; never copied by an insertion; frozen once the version is sent; recorded by its sent event.';

commit;

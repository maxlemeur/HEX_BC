-- Lot 2, sous-lot 2.6 - retour d'une ligne v3 au statut « chiffrée » par l'écrivain de lot.
--
-- Défaillance observée (V3E02, T-STAT, docs/testing/estimate-engine-v3-2.6.md §8) : une ligne passée
-- « Hors lot » n'a pas de PU (décision 3 de 2.5). La remettre « Chiffrée » par
-- public.commit_estimate_batch échouait (« Le lot a été annulé. ») : l'UPDATE de la ligne, avant la
-- projection du lot, posait pricing_status = 'priced' avec pu_ht_cents encore nul, ce que refuse le
-- CHECK estimate_items_item_type_payload_check (PU obligatoire d'une ligne chiffrée).
--
-- Un PU provisoire nul satisfait ce CHECK sans rien décider : la projection du même lot
-- (public.bulk_update_estimate_items) écrit ensuite le PU du moteur, puis
-- private.estimate_v3_assert_draft vérifie le PU de chaque ligne chiffrée (D12) dans la même
-- transaction ; un PU provisoire resté tel quel y serait refusé. Seule une ligne v3 peut quitter le
-- statut « chiffrée » (CHECK de M4 : `priced` seulement en v1/v2), donc le déclencheur est sans effet
-- sur une v1/v2 et ne lit aucun moteur.

create function private.provision_estimate_item_v3_repriced_pu()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.item_type = 'line'::public.estimate_item_type
    and new.pricing_status = 'priced'::public.estimate_line_pricing_status
    and old.pricing_status is distinct from 'priced'::public.estimate_line_pricing_status
    and new.pu_ht_cents is null
  then
    new.pu_ht_cents := 0;
  end if;
  return new;
end;
$$;

comment on function private.provision_estimate_item_v3_repriced_pu() is
  'Engine 3 line trigger (2.6): provisional zero PU when a non-priced line becomes priced again, replaced by the batch projection and checked by private.estimate_v3_assert_draft (D12) in the same transaction.';

revoke all on function private.provision_estimate_item_v3_repriced_pu()
  from public, anon, authenticated, service_role;

create trigger ac_provision_estimate_item_v3_repriced_pu
  before update of pricing_status on public.estimate_items
  for each row execute function private.provision_estimate_item_v3_repriced_pu();

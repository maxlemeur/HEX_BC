-- Lot 2, sous-lot 2.0 : migration synthétique du mode contrôle négatif du test de montée de
-- version (`npm run db:upgrade-check -- <libellé> --negative-control`).
--
-- Ce fichier n'est PAS une migration du dépôt. En mode contrôle négatif seulement,
-- `scripts/engine-v3/upgrade-check.ts` l'applique après les migrations postérieures à la base
-- publiée, par le même chemin qu'elles (psql en une transaction, ligne d'historique de la CLI,
-- inventaire local), sous la version 29991231235959. Il modifie UNE valeur stockée de la
-- fixture, comme le ferait une migration fautive : la comparaison doit la signaler et le test
-- doit échouer en nommant la ligne. La différence attendue est conservée dans
-- `upgrade_check.injected_change`, que le script relit.

create table upgrade_check.injected_change as
select upgrade_check.apply_negative_control() as difference;

alter table upgrade_check.injected_change enable row level security;
revoke all on upgrade_check.injected_change from public, anon, authenticated;

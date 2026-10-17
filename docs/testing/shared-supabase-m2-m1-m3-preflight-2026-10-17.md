# Contrôle préalable M2, M1, M3 — 17/10/2026

> État historique avant autorisation du rattrapage. Les six migrations ont ensuite été appliquées et vérifiées : voir le [rapport de clôture](./shared-supabase-m2-m1-m3-application-2026-10-17.md).

**Résultat : bloqué avant toute écriture distante.** Le connecteur Supabase est accessible ; aucun appel à `apply_migration` n'a été effectué. Le refus de permissions signalé dans Claude n'a pas été reproduit ici.

Projet vérifié : `ijropnynpwjbllievrip` (`bon_de_commande`, connexion `max`), identique au projet de `.mcp.json`. Révision locale : `b91f938fa6e36db27a472cba095693553d1a41fe`, branche `main`. Contrôle à 2026-10-17 17:32:06 UTC.

## Blocages vérifiés en lecture seule

| Migration | Dépendance absente sur la base partagée | Conséquence |
|---|---|---|
| M2 | `public.create_estimate_purchase_order_drafts(uuid,uuid,jsonb,jsonb)` | Son préflight lèverait `LOT2_2_2_PREREQUISITE_MISSING` avant toute modification. |
| M2 | Tables `private.estimate_purchase_receipts`, `private.estimate_purchase_transfers`, `private.purchase_order_item_history` ; colonnes d'unités des achats | La préparation des achats antérieure à M2 n'est pas installée. Les quantités des achats sont encore de type `integer`. |
| M1 | `public.estimate_offer_trim(text)` | La fonction SQL `estimate_offer_client_items_match` de M1 appelle une fonction absente ; M1 ne peut pas être considérée applicable sur ce socle. |

Les objets attendus de M2/M3 sont absents, et la contrainte des moteurs admet actuellement seulement 1 et 2. Aucun moteur hors {1,2}, aucun prix fournisseur négatif. La base contient 398 versions moteur 1 et 840 versions moteur 2 au contrôle.

## Sources des prérequis manquants identifiés

1. `supabase/migrations/20261011083209_transactional_estimate_purchase_preparation.sql` : reçus, transferts et RPC des achats.
2. `supabase/migrations/20261011091744_purchase_decimal_quantities_and_stable_edits.sql` : quantités décimales, unités et historique des achats.
3. `supabase/migrations/20261013130248_estimate_offer_client_contract.sql` : contrat d'offre et `estimate_offer_trim`.

Cette liste identifie des dépendances directes ; elle ne constitue pas une qualification complète du rattrapage. Ces migrations antérieures dépassent le périmètre M2/M1/M3. Elles ont des effets sur des données existantes : initialisation des transferts, métadonnées des achats et classification d'anciens emails/jetons. Leur exécution doit être préparée et validée avant application, sur une autorisation couvrant ce périmètre.

Après résolution des prérequis : conserver l'ordre **M2 → M1 → M3**, vérifier chaque étape, puis comparer les conseillers de sécurité. M4 reste hors périmètre.

## Vérifications et limites

- Les empreintes SHA256 des trois scripts correspondent au manifeste du dépôt.
- `npm run supabase:validate` et `npm run units:sql -- --check` réussissent.
- Conseillers de sécurité avant opération : 5 informations RLS sans politique et 59 avertissements (18 fonctions accessibles à anon, 40 à authenticated, 1 protection des mots de passe). Il s'agit d'un inventaire existant, pas d'une preuve d'exploitabilité.
- Aucun test E2E applicatif exécuté dans cette intervention ; aucune migration appliquée, aucun déploiement.
- Les fichiers utilisateur et l'archive de passation existants sont préservés.

Requêtes exactes, réponses du catalogue, inventaire distant et empreintes : [preuve JSON](./shared-supabase-m2-m1-m3-preflight-2026-10-17.json).

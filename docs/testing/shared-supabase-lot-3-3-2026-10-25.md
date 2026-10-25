# Lot 3.3 appliqué au Supabase partagé — 25 octobre 2026

**Trois migrations appliquées et vérifiées sur `bon_de_commande`
(`ijropnynpwjbllievrip`). L'advisor 0028 passe de 2 à 0.** Autorisation explicite
du porteur dans ce chat pour appliquer les trois migrations et vérifier le résultat.
Aucun déploiement de l'application ni changement d'abonnement ou de réglage Auth.

## Application

Source immuable : `cdb1adf1`, déjà sur main. SQL exact transmis à apply_migration
du MCP Supabase, BEGIN/COMMIT compris, dans l'ordre ; une exécution réussie par
fichier. Les trois instructions enregistrées ont le SHA-256 exact du fichier.
Le refus d'approbation du tour précédent n'avait rien exécuté. Aucun db push.

| Migration | Octets | Version distante / heure UTC du 25/10 |
| --- | --- | --- |
| `20261025112108_consolidate_shared_catalog` | 5 504 | `20261025115246` / 11:52:46 |
| `20261025112109_restrict_public_function_execution` | 2 199 | `20261025115301` / 11:53:01 |
| `20261025112146_reconcile_shared_migration_history` | 2 563 | `20261025115317` / 11:53:17 |

SHA-256, versions, contrôles et résultats détaillés : [reçu JSON](shared-supabase-lot-3-3-2026-10-25.json).
La [préparation](lot-3-3-shared-consolidation-2026-10-25.md) conserve les validations
locales et leurs limites ; aucune ancienne suite n'a été présentée comme rejouée ici.

## Résultat vérifié sur le partagé

- **337 fonctions public ; accès anon 99 → 0 ; aucun EXECUTE pour PUBLIC.** Les
  droits authenticated des fonctions conservées sont identiques. Seules les quatre
  insertions modèle/ouvrage et leurs wrappers perdent service_role, comme prévu.
- **Garde d'insertion des approbations actif.** Triggers canoniques de scope et
  updated_at des explications restaurés ; trigger de scope des sources legacy
  conservé et fermé à anon. Fonction de scope remplacée et fonction d'item de
  modèle orpheline supprimées sans CASCADE.
- **RPC Vault service-only**, SECURITY DEFINER, search_path vide. Les quatre
  corps de fonctions rétablis/versionnés correspondent au SQL source. Tous les
  autres corps, modes, propriétaires et configurations conservés sont inchangés.
- **Defaults postgres fermés à PUBLIC/anon**, globalement et dans public ; accès
  authenticated/service_role préservés. Les defaults gérés de supabase_admin et
  les autres defaults non ciblés sont inchangés.
- **Historique 324 → 330** : trois migrations exécutées et trois reçus historiques
  ajoutés. Les 324 anciennes lignes sont identiques, versions, noms et empreintes
  compris. Tous les doublons sont conservés. Les trois reçus ajoutés ne contiennent
  qu'un commentaire « original SQL NOT executed », avec l'empreinte du fichier
  historique : aucun ancien corps n'a été rejoué.

Les deux successeurs vérifiés avant D5 restent inchangés :
replace_estimate_assembly_items et insert_estimate_assembly_into_version.
Les noms atomic_estimate_batch et estimate_fixed_discount_and_template_parent_integrity
restent représentés par leurs lots historiques part_*, déjà documentés ; ils ne
doivent pas être rejoués.

## Vérifications de comportement

Une transaction sur le partagé a exercé les rôles PostgreSQL et le vrai trigger,
puis a été annulée intégralement :

- trois insertions d'approbation invalides refusées avec les messages exacts du
  garde (pending avec décideur, pending avec date, décision sans ses champs) ;
- appel de current_tenant_id par anon refusé avec 42501 et le message ACL exact ;
- lecture Vault par authenticated refusée avec 42501 ;
- les quatre insertions/wrappers refusés à service_role avec les messages ACL exacts ;
- appel Vault avec nom NULL par service_role réussi, retour NULL attendu : aucune
  valeur de secret réel n'a été lue.

Les tables estimate_approvals, estimate_explanations et estimate_explanation_sources
étaient vides et le restent. Leurs compteurs et empreintes sont identiques au
préflight, après migration et après rollback des sondes. Aucun scénario métier
hébergé avec utilisateur connecté ni campagne HTTP/UI n'a été exécuté ; les preuves
de parcours restent les validations locales de préparation. SQL de la sonde
conservé localement dans `outputs/lot-3-3-shared-verification.sql`.

## Advisors et limites restantes

L'[advisor 0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
est absent après application (**2 → 0**). Les autres catégories observées sont :

- SECURITY DEFINER exécutables par authenticated : 70 → 69, après retrait de
  l'ancienne fonction de trigger ; ce constat ne certifie pas à lui seul chaque RPC ;
- RLS sans policy : 19, inchangé ;
- protection des mots de passe compromis désactivée : 1, inchangé. D4 reste
  indisponible sur l'offre Free, comme vérifié lors de la préparation. Voir la
  [documentation Auth](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Le projet est ACTIVE_HEALTHY. Aucun accès de compte, secret ou donnée personnelle
n'a été ajouté ou publié. Les fichiers SQL appliqués et le manifeste sont inchangés.

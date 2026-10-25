# Lot 3.3 — préparé et validé, application partagée en attente

Code : `cdb1adf1`, base `7a23e63a`. **Les trois migrations ne sont pas appliquées
au partagé.** Le contrôle d'approbation automatique a refusé `apply_migration`
avant exécution, faute d'autorisation distincte pour l'action distante. Aucun
déploiement n'a eu lieu.

## Changements prêts

| Décision | Migration | Effet |
| --- | --- | --- |
| D1 | [consolidate_shared_catalog](../../supabase/migrations/20261025112108_consolidate_shared_catalog.sql) | Restaure le garde d'insertion des approbations et les triggers canoniques d'explication ; versionne la lecture Vault service-only ; retire les fonctions remplacées/orphelines sans CASCADE. |
| D2/D3 | [restrict_public_function_execution](../../supabase/migrations/20261025112109_restrict_public_function_execution.sql) | Ferme PUBLIC/anon sur les fonctions public et les defaults postgres, préserve les droits effectifs connectés ; retire service_role des quatre insertions modèle/ouvrage et wrappers. |
| D5 | [reconcile_shared_migration_history](../../supabase/migrations/20261025112146_reconcile_shared_migration_history.sql) | Ajoute les trois reçus historiques manquants après contrôle des corps successeurs et de leur historique. Aucun ancien SQL rejoué ; doublons conservés. |

Le trigger de sources d'explication du partagé reste nécessaire à ses colonnes
legacy NOT NULL : sa branche est versionnée sous condition, sans ajouter ces
colonnes à une base neuve. La synchronisation source_type/source_label reste
conservée. Une dépendance inattendue bloque les suppressions RESTRICT.

D2 ferme les defaults du créateur **postgres**, propriétaire des 337 fonctions
applicatives observées. Les defaults gérés de **supabase_admin** restent inchangés,
car ce rôle n'est pas administrable par cette connexion. Le retrait global de
PUBLIC conserve explicitement les defaults globaux authenticated/service_role,
qui les recevaient auparavant par PUBLIC.

D4 est indisponible avec l'offre actuelle : le tableau de bord affiche **FREE**
et réserve « Prevent use of leaked passwords » à Pro ou supérieur. Aucun réglage
Auth ni abonnement modifié. Voir la [documentation Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Préflight partagé du 25 octobre 2026

Cible : `ijropnynpwjbllievrip` (`bon_de_commande`). Lecture seule :

- 324 lignes d'historique, dont la migration de création de modèle de #105 ;
- 337 fonctions public, 99 exécutables par anon, dont les deux SECURITY DEFINER
  de scope d'explication ; advisor 0028 : **2**, encore présent ;
- garde d'insertion absent ; ancienne fonction d'item de modèle sans dépendance ;
  fonction de scope d'explication dépendante de son seul trigger ;
- RPC Vault réservée à service_role ; aucune valeur de secret lue ;
- successeurs D5 égaux aux fichiers après normalisation CRLF : MD5
  `f61dd48d0023fde77519719ff10c01ad` pour replace_estimate_assembly_items et
  `e5ee6c9bca61a4687281ef75be94db98` pour insert_estimate_assembly_into_version.

Catalogue et historique inchangés lors de la relecture précédant la tentative.
Le refus d'approbation ne constitue pas un reçu d'application.

Deux autres noms du dépôt sont représentés par des lots historiques :
atomic_estimate_batch (part_1/part_2) et
estimate_fixed_discount_and_template_parent_integrity (part_1 à part_9).
Ne pas les rejouer. Les trois autres trous historiques sont ceux de D5.
Les noms dupliqués restent conservés : catalog_suggestions (2),
duplicate_version_source_metadata_fix (3), affaire_intake_classification_source (2).

## Qualification locale

macOS arm64, Node **26.12.1**, CLI Supabase **2.121.0**, piles natives jetables,
TesterArmy **0.21.3**, web **0.15.3**, Playwright **1.64.1**. Checkout de QA isolé
sans .env, corpus public fictif. Campagne : base
`7a23e63a7fce9bb5ffa4a692700393c59d1b04a9`, diff SHA-256
`99064de8f5f87faee1ecf49b399ce3617e3a1eea4b7b866a52fba29a19879719`.

| Commande | Résultat |
| --- | --- |
| `npm run supabase:types` | PASS : 36 fichiers pgTAP / 2 367 assertions, plafonds SQL 2/2, RLS, génération déterministe, nettoyage. Inclut les contrôles de db:ci:local, non dupliqués. |
| `node --import tsx scripts/verify-shared-base-upgrade.ts 7a23e63a` | PASS pour le lot : simulation legacy, 22 assertions de rôles/Vault/approbation/provenance et réapplication idempotente ; comparaison des sondes ci-dessous. |
| `npm run e2e:army:local -- --grep 'BIZ01\|LEGASM01\|IO06'` | PASS : setup et trois parcours, 4/4, aucun saut ni retry. |
| `npm run verify:pr` | PASS : audits, hygiène, types, architecture, OpenAPI, typage, lint, recettes, 3 547 tests node, 843 jsdom, 12 critiques. Une suite et trois cas node préexistants ignorés, non comptés comme réussis. |
| Garde migrations et `git diff --cached --check` | PASS. |

L'upgrade reproduit les colonnes/triggers legacy, le garde absent et les trous
d'historique. Il contrôle l'ajout de trois lignes sans modifier les anciennes,
la conservation des corps d'écriture et l'idempotence. Vault utilise seulement
un secret fictif sous rollback. Revue indépendante : aucun constat restant.

Les quatre sondes supplémentaires conservent exactement les cas **et erreurs**
de la baseline figée sur le même schéma produit. Seuls les defaults des helpers
sont rétablis dans la transaction baseline, annulée par P9001. Les cas
anonymous/acl affectés sont verts. Résultats : provenance 19/19 ; batch 88 cas
avec quatre échecs historiques identiques ; ouvrages générés 100/100 ; couverture
34 cas avec un échec historique identique. **Absence de régression, pas réussite
de toutes les sondes.**

Échecs conservés : receipt-over-2mib, section-excess-depth, nondraft-new-intent,
replay-nondraft-expired-session (batch), nondraft-replay (couverture). Ils portent
sur le refus nommé des reçus trop grands, l'admission de profondeur et le nouveau
contrat d'émission. Leurs détails restent dans le log. Les droits ajoutés aux
seuls helpers pg_temp disparaissent avec le rollback obligatoire.

Les essais initiaux restent identifiés comme échoués : fixtures d'explication
incomplètes, defaults des helpers connectés, typage du runner, puis première
campagne invalidée par modification des sources. Les résultats finaux les
remplacent uniquement pour les entrées corrigées et rejouées.

Preuves locales : `outputs/lot-3-3-database-types-attempt4.log`,
`outputs/lot-3-3-upgrade-final.log`, `outputs/lot-3-3-e2e-final.log`,
`outputs/lot-3-3-verify-pr-final.log`, préflight sans secret et résultats natifs
de campagne sous `outputs/lot-3-3-qa/`. Ces résultats ne qualifient pas une base
hébergée après migration ni un déploiement de l'application.

## Application après autorisation distincte

Relire cible, historique et objets ; appliquer les trois fichiers exacts de
`cdb1adf1`, dans l'ordre avec apply_migration. Pas de db push ni de rejeu ancien.
Contrôler ensuite les noms/hashes enregistrés, corps, ACL, triggers, conservation
de l'historique et advisor 0028 ; enregistrer un reçu distinct. Le réglage Auth
reste conditionné à l'offre ; le déploiement reste une action séparée.

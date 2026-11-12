# Supabase partagé — rattrapage de main du 12 novembre 2026

Les six migrations de `origin/main` absentes de l'historique sont appliquées sur `bon_de_commande` (`ijropnynpwjbllievrip`), base partagée servant la production. L'historique passe de **380 à 386 lignes** ; chaque SQL enregistré est identique au fichier, saut final inclus. Aucun déploiement.

Source figée après `git fetch origin main` : `757224ee880a294d41110a684bf512d879af3019`, 331 fichiers SQL. Aucun fichier plus récent que le n°6. Un second fetch avant le commit lit `d1dd8153d32810b394268d40ef7e8ac910747163` : les migrations et leur manifeste sont inchangés depuis la source d'application. L'autorisation explicite du propriétaire couvre les applications, les contrôles et cette PR de reçu. Procédure : [appliquer sur une base partagée](../../supabase/README.md#appliquer-sur-une-base-partagée). Détails, empreintes, requêtes et résultats : [JSON](./shared-supabase-main-catchup-2026-11-12.json).

## Anciennes migrations représentées par des fragments

| Fichier canonique | Entrées historiques | Résultat |
| --- | --- | --- |
| [20261012030743_atomic_estimate_batch.sql](../../supabase/migrations/20261012030743_atomic_estimate_batch.sql) | `atomic_estimate_batch_part_1` à `part_2` | 371 lignes non vides identiques |
| [20261014114943_estimate_fixed_discount_and_template_parent_integrity.sql](../../supabase/migrations/20261014114943_estimate_fixed_discount_and_template_parent_integrity.sql) | `estimate_fixed_discount_and_template_parent_integrity_part_1` à `part_9` | 2 880 lignes non vides identiques |

Comparaison du SQL enregistré, dans l'ordre historique, aux blobs de la tête figée : retrait des seuls `BEGIN;` et `COMMIT;` extérieurs de chaque fichier/fragment, puis recherche de chaque corps de fragment comme sous-chaîne contiguë exacte dans le fichier canonique, dans l'ordre ; seuls des blancs sont permis entre fragments. Aucune normalisation des corps de fonctions ou des littéraux. Commentaires, indentation, littéraux, corps de fonctions et instructions restent identiques. Seules les limites de transaction et des blancs diffèrent ; cela prouve la couverture du SQL, pas une transaction unique lors des applications historiques. Ces anciens fichiers n'ont pas été rejoués. Les noms historiques sans horodatage sont aussi reconnus par leur suffixe exact ; aucun fichier source ne reste sans couverture après le lot.

## Applications

| Ordre / PR | Migration | Version distante UTC | Octets fichier / enregistrés |
| --- | --- | --- | ---: |
| 1 / #247 | [20261111224927_product_catalogue_status.sql](../../supabase/migrations/20261111224927_product_catalogue_status.sql) | `20261112094813` | 18424 / 18424 |
| 2 / #250 | [20261111233221_takeoff_zone_coverage_warning.sql](../../supabase/migrations/20261111233221_takeoff_zone_coverage_warning.sql) | `20261112094855` | 2024 / 2024 |
| 3 / #225 | [20261112004040_catalogue_engineer_rights.sql](../../supabase/migrations/20261112004040_catalogue_engineer_rights.sql) | `20261112100123` | 13434 / 13434 |
| 4 / #252 | [20261112014046_material_requests.sql](../../supabase/migrations/20261112014046_material_requests.sql) | `20261112100150` | 43574 / 43574 |
| 5 / #253 | [20261112021509_material_request_line_cap.sql](../../supabase/migrations/20261112021509_material_request_line_cap.sql) | `20261112100216` | 5443 / 5443 |
| 6 / #248 | [20261112025548_takeoff_page_decisions.sql](../../supabase/migrations/20261112025548_takeoff_page_decisions.sql) | `20261112100256` | 104771 / 104771 |

Un appel `apply_migration` par fichier, dans l'ordre ci-dessus, avec le SQL exact des blobs. Les transactions explicites sont conservées. Le n°4, sans transaction explicite, est envoyé en un seul appel ; ses deux déclencheurs sur `storage.objects` sont créés sans contournement. Le n°6 ne réécrit aucune donnée à son application : ses mutations sont dans les corps de fonctions et ne s'exécutent que lors d'appels ultérieurs.

Deux confirmations du connecteur ont expiré, pour les n°1 et n°3. L'historique a été relu avant chaque relance : respectivement 380 et 382 lignes, nom visé absent. Chaque migration réussie apparaît une seule fois, avec une seule instruction enregistrée. Taille et SHA-256 ont été relus après chacune, puis pour les six à la fin.

Les 380 entrées précédentes, SQL inclus, restent identiques : empreinte avant et après exclusion des six noms ajoutés `c38889f9ce73137dbcdc38aca29eaaafb3294afda2e10fffb0e860aa6f1f9f48`. L'horodatage distant indique l'application, distincte de l'horodatage du fichier.

## Contrôles sur la base partagée

- **Catalogue (n°1)** : cinq colonnes présentes ; `catalogue_status` est text, non nulle, défaut `validated` ; deux contraintes et déclencheur actifs. Aucun produit en `draft`. `catalogue_products_page` a 11 arguments avec valeurs par défaut, dont `p_catalogue_statuses` ; `create_supply_type` existe. `authenticated` a EXECUTE, `anon` ne l'a pas.
- **Couverture (n°2)** : avertissement `ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN` non bloquant ; échec de code inconnu et règles périmées bloquants ; marqueur présent dans la définition ; `search_path=pg_catalog, pg_temp` et ACL conservés.
- **Droits catalogue (n°3)** : `tenant_catalogue_policies` avec RLS ; colonnes `created_by` uuid nullables et nulles sur toutes les lignes observées ; trois déclencheurs actifs ; deux fonctions présentes. Les six anciennes politiques admin ont disparu, remplacées par les six politiques « Catalogue editors can … ».
- **Demandes (n°4)** : quatre tables vides, RLS active et forcée, aucun droit `anon` ; cinq déclencheurs métier actifs. RPC d'options accessible à `authenticated` et `service_role`, pas à `anon`. Bucket privé `material-requests`, limite 20 971 520 octets, JPEG/PNG/WebP ; trois politiques Storage et deux déclencheurs Storage actifs.
- **Limite de lignes (n°5)** : `MATERIAL_REQUEST_LINE_LIMIT` présent dans `private.enforce_material_request_line_write`, `search_path=""` conservé.
- **Pages (n°6)** : table vide, RLS active et forcée, SELECT seul pour `authenticated`, aucun droit `anon` ; politique et déclencheur attendus. RPC de décision à deux arguments et wrapper à six arguments accessibles à `authenticated`, pas à `anon` ; wrapper SECURITY INVOKER. Surcharges guarded à quatre et cinq arguments SECURITY DEFINER, `search_path=pg_catalog` exactement, toutes deux avec `takeoff_prepare_page_decisions`. Les 16 nouvelles fonctions privées, dont `assert_takeoff_pages_once`, n'ont EXECUTE pour aucun des rôles `anon`, `authenticated`, `service_role`.

**Réserve ACL explicite :** l'attente littérale « EXECUTE pour authenticated seulement » du n°1 n'est pas satisfaite pour `service_role`. La base lui accordait déjà EXECUTE par défaut ; le SQL exact du fichier révoque `PUBLIC` et `anon`, mais ne révoque pas `service_role`. La fonction recréée conserve donc cet accès serveur, comme `create_supply_type`. Aucun SQL hors périmètre n'a été ajouté pour retirer ce droit. Tous les autres contrôles demandés sont conformes.

## Avis de sécurité

| Avis | Avant | Après |
| --- | ---: | ---: |
| [RLS active sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 24 INFO | 24 INFO |
| [SECURITY DEFINER accessible à authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 70 WARN | 73 WARN |
| [Protection des mots de passe divulgués désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 WARN | 1 WARN |

Les seuls nouveaux constats concernent `create_supply_type`, `set_tenant_catalogue_policy` et `record_takeoff_page_decisions`, nouvelles fonctions publiques SECURITY DEFINER prévues par les fichiers. Aucun autre constat ajouté ou retiré, après comparaison des identités et détails hors heure d'observation. Les avertissements préexistants restent ouverts.

## Compatibilité, preuve et reprise

**Après le n°6, l'application actuellement en production refuse de remesurer une page déjà entrée dans un devis avec `TAKEOFF_PAGE_ALREADY_APPLIED` tant que main n'est pas déployé. Le déploiement reste une décision séparée du propriétaire.** Cette conséquence vient du contrat SQL/application relu ; aucun parcours authentifié d'écriture n'a été lancé en production pour la provoquer.

La preuve couvre l'identité des SQL, les objets, les droits, les comptages et les trois appels purs du garde de règles. Elle ne qualifie ni un déploiement, ni un parcours métier authentifié, ni une release. Le diff de cette PR est documentaire uniquement ; aucune suite applicative locale relancée. Contrôles locaux : cohérence des reçus, liens relatifs et `git diff --check`.

Revue indépendante en lecture seule du lot sur la tête figée : aucune autre anomalie ; la réserve ACL ci-dessus est conservée. Aucune migration de PR ouverte n'a été appliquée, aucun secret ou document client n'est inclus. Une annulation de cette PR documentaire ne retire pas les migrations déjà appliquées ; toute correction distante demanderait un périmètre propre.

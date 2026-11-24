# Choix des plans à la confirmation du brief · 25 novembre 2026

La migration de la PR #547 a été appliquée à la base partagée le **25 novembre à 00:54:55, heure de Paris** (24 novembre à 23:54:55 UTC). Les deux demandes existantes ont conservé leur mandat et leur état. Aucune analyse n’a démarré. [PR #547](https://github.com/maxlemeur/HEX_BC/pull/547) · [Migration](../../supabase/migrations/20261124211251_takeoff_brief_plan_choice.sql)

| Identité | Valeur vérifiée |
| --- | --- |
| Commit sur `main` | `8b706bb1452bc8d0865b816a89a7378792ffa21a` |
| Nom enregistré | `20261124211251_takeoff_brief_plan_choice` |
| Version distante | `20261124235455` |
| SQL enregistré | Un appel à `apply_migration`, une entrée de 31 329 octets, saut de ligne final compris |
| SHA-256 du fichier et du SQL enregistré | `83b5a179d198941a978e2d63b103828b3d4a6aaae12394f3aee43605f0b77a0d` |

L’historique est passé de 448 à 449 entrées. Les 448 premières ont conservé leur empreinte. La migration de la [PR #535](https://github.com/maxlemeur/HEX_BC/pull/535) figurait sur `main` et était absente de l’historique partagé.

## Données avant et après

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Demandes automatiques closes | 1 | 1 |
| Demandes manuelles closes | 1 | 1 |
| Demandes en évaluation ou admises | 0 | 0 |
| Analyses terminées avec succès / en échec | 1 / 2 | 1 / 2 |
| Analyses non finales mises à jour dans les dix minutes précédentes | 0 | 0 |
| Confirmations de brief / jeux de plans | 1 / 10 | 1 / 10 |

Le SHA-256 calculé sur les identifiants des demandes et leurs champs de mandat, dans l’ordre des identifiants, est resté `ac1231862d30b1b48bfabe8db9f1213858f11f6f14617f972038d95b90cc64e2`. Les trois nouvelles colonnes sont NULL sur toutes les lignes existantes. Les quatre tables d’activation comptaient chacune une ligne avant et après. Le point de santé de production a répondu HTTP 200, version 0.9.0, base disponible lors des deux contrôles. [Santé de production](https://hex-bc.vercel.app/api/health)

## Catalogue et droits

Avant application, les prédicats des deux nouveaux index donnaient chacun zéro groupe en doublon sur `(tenant_id, project_id)`. Le contrôle de l’index historique projetait la nouvelle colonne nullable à NULL pour chaque ligne existante.

| Index unique vérifié valide et prêt | Demandes couvertes |
| --- | --- |
| `takeoff_launch_pending_automatic_uidx` | Automatiques en état `blocked`, `evaluating` ou `not_eligible` |
| `takeoff_launch_legacy_automatic_uidx` | Automatiques dont `selected_plans` est NULL |

L’ancien index `takeoff_launch_requests_automatic_uidx` est absent. Les demandes et les confirmations portent chacune une colonne `selected_plans` de type JSONB. Les confirmations portent aussi `choice_request_id` de type UUID. Les trois colonnes acceptent NULL sans valeur par défaut. La contrainte de sélection sur les demandes est validée. Les déclencheurs `lock_takeoff_import_plan_sets` sur `public.plan_sets` et `check_takeoff_brief_plan_admission` sur `public.takeoff_launch_requests` sont activés.

Les quatre fonctions remplacées correspondaient aux corps du parent de #547 avant l’application. Après application, les onze corps correspondent à la migration. Les sept fonctions privées sont exécutables par leur propriétaire seul. Les quatre fonctions publiques sont exécutables par `service_role` et leur propriétaire. Les sept fonctions `SECURITY DEFINER` fixent un `search_path` vide. La comparaison des avis Supabase de sécurité et de performance avant et après application n’a relevé aucun nouveau constat lors du contrôle.

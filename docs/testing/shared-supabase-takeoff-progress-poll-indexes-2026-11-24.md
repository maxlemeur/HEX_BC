# Index de suivi des analyses · 24 novembre 2026

La base partagée a enregistré la [migration de la PR #546](../../supabase/migrations/20261124202259_takeoff_progress_poll_indexes.sql) à **21:17:15 UTC**, sous la version distante **`20261124211715`**. Un appel à `apply_migration` a créé quatre index partiels sur `public.takeoff_jobs`. [PR #546](https://github.com/maxlemeur/HEX_BC/pull/546)

| Identité | Valeur |
| --- | --- |
| Nom enregistré | `20261124202259_takeoff_progress_poll_indexes` |
| Commit source sur `main` | `e5bd73e4da9f5a5a8afdae0fe1e99d9d637cf9a7` |
| SQL enregistré | Une entrée de 1 016 octets, saut de ligne final compris |
| SHA-256 du fichier et de l’entrée | `63578c186d234355dec8f2ec3c1f6528cd9ae54dba7e63fe77902ad218a3650d` |

L’historique est passé de 446 à 447 entrées. L’empreinte des 446 entrées antérieures, jusqu’à la version `20261124201411`, est identique avant et après. La migration `20261124174040_material_request_original_pdfs` de la [PR #535](https://github.com/maxlemeur/HEX_BC/pull/535) figure sur `main` et est absente de l’historique partagé au contrôle final.

## Conditions d’application

À 21:17:02 UTC, la table contenait trois analyses et aucun des quatre index. Aucune analyse n’était en traitement ni dans un état non terminal mis à jour dans les dix dernières minutes. Le contrôle des verrous ne relevait aucune demande incompatible. À cette taille et dans ces conditions, le verrou `SHARE` des créations ordinaires était acceptable. Les lectures restent possibles pendant la construction et les écritures concurrentes attendent la fin de la transaction.

## Catalogue et santé après application

Les quatre index sont valides et prêts. Tous commencent par `tenant_id`, puis trient la date indiquée et `id` par ordre décroissant. Tous exigent `launch_request_id IS NULL`.

| Index | Date de tri | Prédicat complémentaire |
| --- | --- | --- |
| `takeoff_jobs_progress_live_idx` | `created_at` | `completed_at IS NULL` |
| `takeoff_jobs_progress_analysis_finished_idx` | `analysis_finished_at` | `analysis_finished_at IS NOT NULL` |
| `takeoff_jobs_progress_completed_idx` | `completed_at` | `analysis_finished_at IS NULL AND completed_at IS NOT NULL` |
| `takeoff_jobs_progress_legacy_end_idx` | `updated_at` | `analysis_finished_at IS NULL AND completed_at IS NULL` |

Le comptage après application donne trois analyses. Le point de santé a répondu HTTP 200 avant et après, en version `0.9.0`, avec la base disponible. [Santé de production](https://hex-bc.vercel.app/api/health)

La comparaison des avis Supabase par règle et constat donne zéro nouvel avis de sécurité. Les quatre nouveaux avis de performance sont de niveau `INFO`, un par index ci-dessus. Chacun signale que l’index n’avait encore enregistré aucune utilisation au moment du contrôle. [Règle Supabase sur les index inutilisés](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

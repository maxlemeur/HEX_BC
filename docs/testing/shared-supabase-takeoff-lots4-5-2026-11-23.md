# Lots 4 et 5 du métré sur la base partagée · 23 novembre 2026

**9 migrations appliquées et vérifiées** entre 07:31:45 et 07:34:04 UTC. Chaque fichier de `main` a été envoyé en un appel `apply_migration`. Chaque lecture d’identité a précédé l’application suivante. Les neuf appels ont réussi du premier coup. Les quatre tables d’activation restent vides et la production répond HTTP 200 en version **0.7.0**, base disponible.

## Identité des neuf migrations

Pour chaque ligne, le nom est celui du fichier sans extension. Le SHA-256 du [manifeste](../../supabase/migrations.manifest.json), celui des octets envoyés depuis `ac2f74abe7e5c2dad78fe42456748c6bce46339b` et celui de l’unique élément SQL enregistré sont égaux, dernier saut de ligne inclus.

| PR et source | Version distante | Heure UTC | Transaction explicite | Octets | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| [#485](https://github.com/maxlemeur/HEX_BC/pull/485) · [20261122193622_takeoff_item_acceptance_marks_revision](../../supabase/migrations/20261122193622_takeoff_item_acceptance_marks_revision.sql) | `20261123073145` | 07:31:45 | Oui | 83075 | `1564d07990d5746f8c161e06e16aa67c33612099c1560fa5e7d497d547e43180` |
| [#484](https://github.com/maxlemeur/HEX_BC/pull/484) · [20261122205109_takeoff_item_send_writer](../../supabase/migrations/20261122205109_takeoff_item_send_writer.sql) | `20261123073200` | 07:32:00 | Oui | 187647 | `9e35184f0473ed440245d8a4b78628e1b8065e905179a105d522ee5c6bfe15df` |
| [#482](https://github.com/maxlemeur/HEX_BC/pull/482) · [20261122220405_takeoff_item_remeasure_admission](../../supabase/migrations/20261122220405_takeoff_item_remeasure_admission.sql) | `20261123073218` | 07:32:18 | Oui | 49410 | `dd1e9c6cd19d0bbb4f23d1827b12cf49a68d7b18cfc5f04b9fbe97f3a4dcd1d3` |
| [#500](https://github.com/maxlemeur/HEX_BC/pull/500) · [20261123000925_takeoff_item_send_copy](../../supabase/migrations/20261123000925_takeoff_item_send_copy.sql) | `20261123073231` | 07:32:31 | Oui | 21440 | `88485bfc1595b9611b29c2d78afb66499d02c3c22fcaa41c6a6798187415ef34` |
| [#504](https://github.com/maxlemeur/HEX_BC/pull/504) · [20261123001647_guard_copied_takeoff_draft_deletion](../../supabase/migrations/20261123001647_guard_copied_takeoff_draft_deletion.sql) | `20261123073247` | 07:32:47 | Oui | 5783 | `636c422cf1d693eb6c510a2f0c6774143ceeb69898d9eb173eb350559e8fb92b` |
| [#507](https://github.com/maxlemeur/HEX_BC/pull/507) · [20261123004501_takeoff_measure_item_on_plan](../../supabase/migrations/20261123004501_takeoff_measure_item_on_plan.sql) | `20261123073304` | 07:33:04 | Non | 42735 | `794bd8e863019af4d98d75b94a09a3ece4d44f8a052157f027cedb575624a2ec` |
| [#505](https://github.com/maxlemeur/HEX_BC/pull/505) · [20261123005401_takeoff_item_redistribution](../../supabase/migrations/20261123005401_takeoff_item_redistribution.sql) | `20261123073319` | 07:33:19 | Oui | 49715 | `1e2af95b17a5573a27a60f56e7ef70d814e8fe3735dbcd5553cc6efc34499f27` |
| [#508](https://github.com/maxlemeur/HEX_BC/pull/508) · [20261123010932_estimate_line_analysis_scope](../../supabase/migrations/20261123010932_estimate_line_analysis_scope.sql) | `20261123073333` | 07:33:33 | Oui | 12544 | `b41bddd5cd94226fd4e404a0bdfb1f178ec4adc09e901c6624d51e0b1eb21b13` |
| [#506](https://github.com/maxlemeur/HEX_BC/pull/506) · [20261123050517_takeoff_verified_count_source](../../supabase/migrations/20261123050517_takeoff_verified_count_source.sql) | `20261123073404` | 07:34:04 | Oui | 203195 | `c08d5e605e8b33e38aee37845f992723450250f6d9f1ae9870fbdfc1965dbb0e` |

L’historique et `list_migrations` comptent **442 entrées**. Les 433 entrées antérieures conservent le SHA-256 `b051cca924e0bf5f74a5ec3b408a142f609d3cbe6e8790d36335567dfe5fa398`. La liste finale contient les neuf noms et versions dans l’ordre ci-dessus. [Relevé détaillé des contrôles](shared-supabase-takeoff-lots4-5-2026-11-23.json)

## Catalogue et données

- Les cinq tables publiques de l’envoi ont la RLS active et une politique SELECT pour `authenticated` limitée au périmètre de l’affaire. Les droits effectifs observés correspondent aux droits déclarés. La sixième table, `private.takeoff_item_send_checks`, a la RLS désactivée et aucun privilège de table ou de colonne pour les rôles API. Son ACL ne nomme que le propriétaire. La table antérieure `private.takeoff_plan_send_checks` présente la même exception.
- Les huit colonnes ajoutées permettent les insertions existantes. Sept acceptent NULL. La huitième, `takeoff_item_answers.comparison_only`, vaut par défaut `false` et est obligatoire. PostgreSQL marque cette valeur constante comme valeur manquante préenregistrée (`atthasmissing`). Les cinq tables ayant reçu des colonnes contenaient zéro ligne lors des ajouts et en contiennent toujours zéro.
- Les corps des fonctions correspondent aux définitions de chaque fichier. Le catalogue final contient une seule signature pour chacun des 77 noms contrôlés. Les 19 fonctions préexistantes conservent signatures, propriétaires, attributs de sécurité et privilèges. Aucun nouveau droit d’exécution pour `anon` et aucun droit d’exécution API sur les nouvelles fonctions privées. Les 14 déclencheurs applicatifs attendus sont activés et les 20 index contrôlés sont valides.
- Juste avant #508, le nombre de lignes hors périmètre était **0**. La clé étrangère composite validée conserve le nom `estimate_items_source_job_id_fkey` et l’action `ON DELETE SET NULL (source_job_id)`. Les deux fonctions de l’éditeur conservent leur signature, leur propriétaire `postgres` et leurs droits. Leurs MD5 finaux sont `f933b2f9755ab0fc98c0c7e09a62b91e` pour la sauvegarde et `6cf4e8dfa00d9f15aa3ab720ac4d044e` pour la copie.
- Les compteurs des tables existantes sont identiques avant et après, dont **46 862** lignes d’audit. Les tâches, les liens de version, les réponses, les tables de repères et les lignes de devis liées à une analyse restent à zéro. Les six tables créées et les quatre tables d’activation sont vides.

## Écarts documentés et advisor

Deux tentatives de vérification se sont arrêtées avant toute écriture. Le mandat a été précisé pour accepter la transaction implicite de #507, son défaut constant et la protection par privilèges de l’unique table privée. Les anciens fichiers `20261117200342_material_request_affaire_storage_cleanup` et `20261117201102_estimate_orders_in_affaire_supply_cost` contenaient déjà plusieurs commandes sans transaction explicite et chacun un seul élément dans l’historique, aux versions `20261121064816` et `20261121064859`. [Reçu du 21 novembre](shared-supabase-v080-and-takeoff-lot2-2026-11-21.md)

L’advisor de sécurité passe de **134 à 136 constats**, sans retrait. Les deux nouveaux avertissements portent sur les fonctions `SECURITY DEFINER` exécutables par `authenticated`. `public.read_takeoff_item_send_facts` lit les éléments du job et `public.read_takeoff_item_send_draft` lit les contributions du brouillon. Chacune vérifie l’identité, le tenant actif et l’accès à l’affaire. Leurs droits excluent `anon`. [Règle de l’advisor Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

Les contrôles de production ont porté sur la santé, l’historique, le catalogue et les compteurs. La recette fonctionnelle reste à réaliser.

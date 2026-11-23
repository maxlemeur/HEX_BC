# Lots 4 et 5 du métré sur la base partagée · 23 novembre 2026

**0 migration appliquée sur 9.** La première tentative s’était arrêtée sur la transaction implicite de la PR #507 et sa colonne `comparison_only`. Ces deux points sont acceptés dans le mandat corrigé.

À la reprise, la lecture de la [migration #484](../../supabase/migrations/20261122205109_takeoff_item_send_writer.sql) a montré que la boucle active la RLS et crée une politique de lecture pour les cinq tables publiques du journal. Une sixième table, `private.takeoff_item_send_checks`, est créée séparément. Le fichier révoque tous ses privilèges pour `PUBLIC`, `anon`, `authenticated` et `service_role` et laisse volontairement la RLS désactivée. Le mandat demande la RLS sur les tables créées. La série s’est arrêtée avant le premier appel à `apply_migration`.

## Contrôles de reprise

- Historique partagé de **433 lignes**, dernière version `20261122204618`. Aucun des neuf noms et aucune des six tables de la PR #484. L’empreinte reste `b051cca924e0bf5f74a5ec3b408a142f609d3cbe6e8790d36335567dfe5fa398` au dernier contrôle.
- Les quatre tables d’activation comptent chacune **0 ligne**. Les tâches, liens de version, réponses, décisions, neuf tables de repères et lignes de devis liées à une analyse ont aussi un compteur nul. La table d’audit compte **46 862 lignes**.
- Sur les tables existantes qui recevraient une colonne, `takeoff_item_answers` et `takeoff_item_answer_decisions` comptent chacune **0 ligne**. Les trois autres (`takeoff_item_send_receipts`, `takeoff_item_send_targets`, `takeoff_item_send_parts`) restent à créer. La source donne un défaut constant `false` à la seule colonne ajoutée obligatoire, `comparison_only`. Les autres colonnes ajoutées acceptent `NULL`.
- Les trois observations des verrous ont trouvé zéro verrou concurrent et zéro tâche en traitement. Le point de santé a répondu HTTP 200, version **0.7.0**, base disponible.
- Les 19 fonctions existantes correspondent au MD5 de leur corps reconstruit depuis les migrations de `main`, avec une signature chacune. Les 58 noms de fonctions nouvelles sont libres. Pour `public.commit_estimate_batch`, la reconstruction inclut aussi la modification de `20261112093830_unified_kfo`. Les MD5 des deux fonctions de l’éditeur sont `f28e4faec4df9fb74e03f26646d94b0d` (sauvegarde) et `d857de22a6c9a1423155bb9d582470c7` (copie).
- Précontrôles lus sur la base initiale : #485 donne deux zéros, #482 donne trois vrais et deux zéros, #508 trouve **0 ligne hors périmètre**. Cette dernière lecture reste à répéter juste avant #508.
- L’advisor de sécurité initial relève 31 tables avec RLS sans politique, 102 fonctions `SECURITY DEFINER` exécutables par `authenticated` et un avis sur la protection des mots de passe compromis. Il n’y a eu aucune application ni comparaison après application.

## Précédents de transaction implicite

Les fichiers `20261117200342_material_request_affaire_storage_cleanup` et `20261117201102_estimate_orders_in_affaire_supply_cost` contiennent plusieurs commandes et commencent respectivement par `ALTER TABLE` et `CREATE OR REPLACE FUNCTION` après les commentaires. L’historique contient un seul élément SQL par fichier aux versions `20261121064816` et `20261121064859`. Leurs SHA-256 correspondent au [reçu des appels du 21 novembre](shared-supabase-v080-and-takeoff-lot2-2026-11-21.md).

## Neuf fichiers vérifiés

La taille et le SHA-256 de chaque fichier correspondent au mandat et au manifeste sur `main` au commit `ac2f74abe7e5c2dad78fe42456748c6bce46339b`. Aucune version distante, heure d’application ou identité de SQL enregistré ne peut être attribuée aux neuf fichiers.

| PR | Migration | Transaction explicite | Octets | SHA-256 du fichier |
| --- | --- | --- | ---: | --- |
| [#485](https://github.com/maxlemeur/HEX_BC/pull/485) | [20261122193622_takeoff_item_acceptance_marks_revision](../../supabase/migrations/20261122193622_takeoff_item_acceptance_marks_revision.sql) | Oui | 83075 | `1564d07990d5746f8c161e06e16aa67c33612099c1560fa5e7d497d547e43180` |
| [#484](https://github.com/maxlemeur/HEX_BC/pull/484) | [20261122205109_takeoff_item_send_writer](../../supabase/migrations/20261122205109_takeoff_item_send_writer.sql) | Oui | 187647 | `9e35184f0473ed440245d8a4b78628e1b8065e905179a105d522ee5c6bfe15df` |
| [#482](https://github.com/maxlemeur/HEX_BC/pull/482) | [20261122220405_takeoff_item_remeasure_admission](../../supabase/migrations/20261122220405_takeoff_item_remeasure_admission.sql) | Oui | 49410 | `dd1e9c6cd19d0bbb4f23d1827b12cf49a68d7b18cfc5f04b9fbe97f3a4dcd1d3` |
| [#500](https://github.com/maxlemeur/HEX_BC/pull/500) | [20261123000925_takeoff_item_send_copy](../../supabase/migrations/20261123000925_takeoff_item_send_copy.sql) | Oui | 21440 | `88485bfc1595b9611b29c2d78afb66499d02c3c22fcaa41c6a6798187415ef34` |
| [#504](https://github.com/maxlemeur/HEX_BC/pull/504) | [20261123001647_guard_copied_takeoff_draft_deletion](../../supabase/migrations/20261123001647_guard_copied_takeoff_draft_deletion.sql) | Oui | 5783 | `636c422cf1d693eb6c510a2f0c6774143ceeb69898d9eb173eb350559e8fb92b` |
| [#507](https://github.com/maxlemeur/HEX_BC/pull/507) | [20261123004501_takeoff_measure_item_on_plan](../../supabase/migrations/20261123004501_takeoff_measure_item_on_plan.sql) | Non | 42735 | `794bd8e863019af4d98d75b94a09a3ece4d44f8a052157f027cedb575624a2ec` |
| [#505](https://github.com/maxlemeur/HEX_BC/pull/505) | [20261123005401_takeoff_item_redistribution](../../supabase/migrations/20261123005401_takeoff_item_redistribution.sql) | Oui | 49715 | `1e2af95b17a5573a27a60f56e7ef70d814e8fe3735dbcd5553cc6efc34499f27` |
| [#508](https://github.com/maxlemeur/HEX_BC/pull/508) | [20261123010932_estimate_line_analysis_scope](../../supabase/migrations/20261123010932_estimate_line_analysis_scope.sql) | Oui | 12544 | `b41bddd5cd94226fd4e404a0bdfb1f178ec4adc09e901c6624d51e0b1eb21b13` |
| [#506](https://github.com/maxlemeur/HEX_BC/pull/506) | [20261123050517_takeoff_verified_count_source](../../supabase/migrations/20261123050517_takeoff_verified_count_source.sql) | Oui | 203195 | `c08d5e605e8b33e38aee37845f992723450250f6d9f1ae9870fbdfc1965dbb0e` |

[Relevé JSON](shared-supabase-takeoff-lots4-5-2026-11-23.json)

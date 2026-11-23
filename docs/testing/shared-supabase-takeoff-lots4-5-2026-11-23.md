# Lots 4 et 5 du métré sur la base partagée · 23 novembre 2026

**0 migration appliquée sur 9.** La série s’est arrêtée au contrôle des sources, avant le premier appel à `apply_migration`.

Le [fichier de la PR #507](../../supabase/migrations/20261123004501_takeoff_measure_item_on_plan.sql) contient 42 735 octets. Il commence par `set lock_timeout = '5s';`, après deux lignes de commentaire. Il ne contient ni `BEGIN;` ni `COMMIT;` de transaction, alors que le mandat prévoit les deux dans chacun des neuf fichiers. La colonne `takeoff_item_answers.comparison_only` y est déclarée `boolean not null default false` alors que le contrôle prévu attend des colonnes ajoutées nullables. Ajouter un encadrement transactionnel changerait l’empreinte du SQL autorisé.

## État observé

Le 23 novembre à 07:19:58 UTC, l’historique comptait **433 lignes**, dont **0** portant un des neuf noms. Sa dernière version était `20261122204618` (`20261122194343_affaire_site_contacts`). Son SHA-256 était `b051cca924e0bf5f74a5ec3b408a142f609d3cbe6e8790d36335567dfe5fa398`, calculé sur les versions, noms et instructions dans l’ordre des versions, selon la convention du [reçu précédent](shared-supabase-site-contacts-2026-11-22.md).

Les quatre tables privées d’activation `takeoff_completion_activation`, `takeoff_launch_activation`, `takeoff_plan_dispatch_activation` et `takeoff_item_list_order_activation` comptaient chacune **0 ligne**. Les lectures ont porté sur l’historique et les activations. Les contrôles de qualification du catalogue, des verrous, de santé et de l’advisor restent à exécuter à la reprise.

## Sources contrôlées

Les neuf PR sont fusionnées. Pour chaque fichier du commit `ac2f74abe7e5c2dad78fe42456748c6bce46339b`, la taille correspond au mandat et le SHA-256 correspond au mandat et au [manifeste](../../supabase/migrations.manifest.json). Les neuf migrations sont absentes de l’historique. Elles n’ont donc ni version distante, ni heure d’application, ni empreinte de SQL enregistré.

| PR | Migration | Octets | SHA-256 du fichier |
| --- | --- | ---: | --- |
| [#485](https://github.com/maxlemeur/HEX_BC/pull/485) | [20261122193622_takeoff_item_acceptance_marks_revision](../../supabase/migrations/20261122193622_takeoff_item_acceptance_marks_revision.sql) | 83075 | `1564d07990d5746f8c161e06e16aa67c33612099c1560fa5e7d497d547e43180` |
| [#484](https://github.com/maxlemeur/HEX_BC/pull/484) | [20261122205109_takeoff_item_send_writer](../../supabase/migrations/20261122205109_takeoff_item_send_writer.sql) | 187647 | `9e35184f0473ed440245d8a4b78628e1b8065e905179a105d522ee5c6bfe15df` |
| [#482](https://github.com/maxlemeur/HEX_BC/pull/482) | [20261122220405_takeoff_item_remeasure_admission](../../supabase/migrations/20261122220405_takeoff_item_remeasure_admission.sql) | 49410 | `dd1e9c6cd19d0bbb4f23d1827b12cf49a68d7b18cfc5f04b9fbe97f3a4dcd1d3` |
| [#500](https://github.com/maxlemeur/HEX_BC/pull/500) | [20261123000925_takeoff_item_send_copy](../../supabase/migrations/20261123000925_takeoff_item_send_copy.sql) | 21440 | `88485bfc1595b9611b29c2d78afb66499d02c3c22fcaa41c6a6798187415ef34` |
| [#504](https://github.com/maxlemeur/HEX_BC/pull/504) | [20261123001647_guard_copied_takeoff_draft_deletion](../../supabase/migrations/20261123001647_guard_copied_takeoff_draft_deletion.sql) | 5783 | `636c422cf1d693eb6c510a2f0c6774143ceeb69898d9eb173eb350559e8fb92b` |
| [#507](https://github.com/maxlemeur/HEX_BC/pull/507) | [20261123004501_takeoff_measure_item_on_plan](../../supabase/migrations/20261123004501_takeoff_measure_item_on_plan.sql) | 42735 | `794bd8e863019af4d98d75b94a09a3ece4d44f8a052157f027cedb575624a2ec` |
| [#505](https://github.com/maxlemeur/HEX_BC/pull/505) | [20261123005401_takeoff_item_redistribution](../../supabase/migrations/20261123005401_takeoff_item_redistribution.sql) | 49715 | `1e2af95b17a5573a27a60f56e7ef70d814e8fe3735dbcd5553cc6efc34499f27` |
| [#508](https://github.com/maxlemeur/HEX_BC/pull/508) | [20261123010932_estimate_line_analysis_scope](../../supabase/migrations/20261123010932_estimate_line_analysis_scope.sql) | 12544 | `b41bddd5cd94226fd4e404a0bdfb1f178ec4adc09e901c6624d51e0b1eb21b13` |
| [#506](https://github.com/maxlemeur/HEX_BC/pull/506) | [20261123050517_takeoff_verified_count_source](../../supabase/migrations/20261123050517_takeoff_verified_count_source.sql) | 203195 | `c08d5e605e8b33e38aee37845f992723450250f6d9f1ae9870fbdfc1965dbb0e` |

[Relevé JSON](shared-supabase-takeoff-lots4-5-2026-11-23.json)

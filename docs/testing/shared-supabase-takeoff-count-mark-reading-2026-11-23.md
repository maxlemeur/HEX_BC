# Migration du métré par repères de comptage · 23 novembre 2026

La migration de [#510](https://github.com/maxlemeur/HEX_BC/pull/510) a été appliquée à **16:50:35 UTC** sur la base partagée. Un appel à `apply_migration` a enregistré un texte SQL de **65 185 octets**, saut de ligne final compris. L’empreinte SHA-256 du texte enregistré est identique à celle du [fichier source](../../supabase/migrations/20261123061045_takeoff_count_mark_reading.sql) au commit `d48052ce6bc53d4a073a9fee82005f44cd996de3`.

| Version distante | SHA-256 | Historique avant → après |
| --- | --- | --- |
| `20261123165035` | `f250b13c1e906813b16f03c328e7151efab51cfd18601b0edcb9f7f9f6fc5697` | 442 → 443 |

À 16:50:29 UTC, le dernier contrôle comptait zéro analyse en attente ou en traitement, zéro demande ouverte, zéro réservation non réglée et zéro ligne incompatible avec la contrainte de branche. Avant l’application, les cinq fonctions à remplacer correspondaient à leurs dernières définitions sur `main`. L’empreinte des 442 migrations antérieures est identique après l’application.

| Fonction remplacée | MD5 du corps avant | MD5 du corps après |
| --- | --- | --- |
| `private.assert_takeoff_launch_seal` | `21143544b47a66c29ff7199610306028` | `538513821680e3f6979cbf2a9525a202` |
| `private.takeoff_item_remeasure_confirmation_valid` | `a973a44cb49d23311865849e07456adb` | `216c3b357290a12a7c7c20353c418ec5` |
| `public.launch_takeoff_item_remeasure` | `8ed14b073a0a8eb4d3a371e57f62dd6f` | `91a127ab998c1ea571a2b13dd37a6cc2` |
| `public.publish_takeoff_item_answers` | `7dff9fe5f97faeaae70c7361a534425a` | `f78b931f4012b2e3af51c3597c7ff773` |
| `public.reserve_takeoff_launch_call` | `3d69f1fc06e71b6b1e3c5fe8495b289f` | `05ce0d69622583ddcab802f8a0fa4a06` |

Les 16 corps en base correspondent au fichier. Les cinq fonctions remplacées conservent leur signature, leur propriétaire, leur mode de sécurité et leurs droits. Les dix nouvelles fonctions privées sont réservées au propriétaire. Parmi les rôles API, seul `service_role` peut exécuter la nouvelle fonction `SECURITY DEFINER` `public.attest_takeoff_count_mark_pages`.

La table `private.takeoff_attested_count_pages` est vide, sans RLS et accessible à son seul propriétaire. La colonne `private.takeoff_launch_commands.count_mark_schedule` est de type `jsonb`, nullable, sans défaut. Sa contrainte et celle qui étend `takeoff_launch_usage_branch_check` à `count_tile` sont validées.

Les quatre lignes correspondent au [reçu d’activation](shared-supabase-takeoff-activation-2026-11-23.md), dates et paramètres compris. Avant et après l’application, `/api/health` a répondu HTTP 200, version **0.9.0**, base disponible. Cette opération porte uniquement sur le schéma. La dernière révision applicative de #510 reste à relire indépendamment avant de proposer l’option aux membres, conformément à la PR.

L’advisor de performance ajoute un constat **INFO** sur la clé étrangère `takeoff_attested_count_pages_page_id_fkey`, qui n’a pas d’index couvrant. Les constats de sécurité et de santé sont identiques avant et après. [Explication Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) · [Résultats détaillés](shared-supabase-takeoff-count-mark-reading-2026-11-23.json)

# Base partagée · exclusion des analyses, listes de postes et répartition par plan

Le 22 novembre 2026, les migrations #446, #447 et #448 ont été appliquées et vérifiées dans cet ordre. L’historique contient les **420 lignes du reçu précédent**, puis ces trois ajouts. Les quatre tables d’activation sont vides. [Reçu précédent](./shared-supabase-risk-radar-and-launch-requests-2026-11-21.md) · [Résultats détaillés](./shared-supabase-takeoff-exclusion-item-lists-dispatcher-2026-11-22.json)

| Migration | Application UTC | Version distante | Lignes après application | Octets | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| [#446 · Exclusion](../../supabase/migrations/20261121193413_takeoff_launch_exclusion_and_send_requests.sql) | 07:41:55 | `20261122074155` | 421 | 75 112 | `d68a4199cd6f92c240fbb04f6e60aeaec3a7c504dfc81c10ce2a42ecf2cbc229` |
| [#447 · Listes de postes](../../supabase/migrations/20261121230719_takeoff_item_lists.sql) | 07:43:12 | `20261122074312` | 422 | 108 478 | `854e5f1eecea87a5fac95bac688db00aeffb5a5f2195b693bcaea2f1d83138d4` |
| [#448 · Répartition par plan](../../supabase/migrations/20261121231238_takeoff_plan_dispatcher.sql) | 07:45:19 | `20261122074519` | 423 | 140 685 | `a26d784a495f862ee6f2126d96bd2f8d71bfc7ab3264bafbd467106cb8fb4475` |

Chaque application a réussi au premier appel. Après chacune, les octets du SQL enregistré correspondaient au fichier sur `origin/main` au commit `4fb594f2ecca0fbce1bee35894ee850c4cbc6d92`, dernier saut de ligne compris. L’historique a conservé le contenu des lignes antérieures et leur ordre.

## Contrôles avant application

| PR | Heure UTC du contrôle | Tâches de métré / en traitement | Lignes d’audit | Lignes DPGF mappées | Verrous externes sur les tables contrôlées | Santé de production |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| #446 | 07:41:42 | 0 / 0 | 46 772 | 3 704 | 0 | HTTP 200 · v0.7.0 |
| #447 | 07:43:05 | 0 / 0 | 46 772 | 3 704 | 0 | HTTP 200 · v0.7.0 |
| #448 | 07:45:10 | 0 / 0 | 46 772 | 3 704 | 0 | HTTP 200 · v0.7.0 |

Avant chaque appel, les objets à créer étaient absents et les signatures à remplacer étaient présentes. Pour #447, M4 était présente, aucune des deux nouvelles colonnes n’existait, le nombre de lignes mappées était sous le seuil de 1 000 000 et aucune autre transaction active ne dépassait cinq secondes. Pour #448, les trois prérequis (M4, #446 et #447) étaient présents. La table des créneaux de traitement était absente et aucune demande n’était admise. Le contrôle des quatre tables a trouvé zéro détenteur de verrou et zéro session en attente. Il n’y avait aucune transaction longue. Le worker du Mac et la reprise hébergée sont restés dans leur état initial conformément à la procédure retenue pour cette exécution. [Point de santé de production](https://hex-bc.vercel.app/api/health)

## Catalogue et advisor de sécurité

- **#446.** Les huit nouvelles fonctions et les trois fonctions remplacées ont le corps attendu. Les deux déclencheurs sur `takeoff_jobs`, `aac_guard_takeoff_job_outside_request` et `aad_guard_takeoff_job_restart_outside_request`, sont actifs. Aucun nouveau constat de sécurité. [PR #446](https://github.com/maxlemeur/HEX_BC/pull/446)
- **#447.** Les 11 nouvelles tables, les deux colonnes ajoutées aux tables existantes, les 7 index explicites, les 14 déclencheurs et les 36 définitions de fonction ont été contrôlés. Les sept nouvelles tables publiques ont la RLS activée. Cinq accordent la lecture à `authenticated` sous une politique de tenant ou d’affaire. L’advisor signale deux nouveaux **INFO** pour les deux tables sans politique, `public.dpgf_import_confirmations` et `public.takeoff_item_template_drafts`. Le rôle `authenticated` n’a aucun droit de table sur ces deux relations. [PR #447](https://github.com/maxlemeur/HEX_BC/pull/447) · [Fiche de l’advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- **#448.** Les deux nouvelles tables privées ne donnent aucun droit de table aux rôles API. Les cinq colonnes ajoutées à `private.takeoff_launch_usage`, les trois ajoutées à `public.takeoff_launch_requests`, leurs contraintes, les trois index explicites, les trois déclencheurs et les 48 définitions de fonction ont été contrôlés. Sur `takeoff_jobs`, `aa0_guard_takeoff_plan_unit_send` précède `aa1_require_takeoff_host_slot` dans l’ordre alphabétique des déclencheurs. Les gardes de #446 sont toujours présentes. Aucun nouveau constat de sécurité. [PR #448](https://github.com/maxlemeur/HEX_BC/pull/448)

Les corps de fonction ont été comparés par MD5 au texte source après chaque migration. Le JSON précise les signatures, les droits, les états d’activation et l’ordre des déclencheurs. Une valeur d’activation `null` indique que la table n’existait pas encore à cette étape.

## État final et limite applicative

Les quatre tables privées `takeoff_completion_activation`, `takeoff_launch_activation`, `takeoff_item_list_order_activation` et `takeoff_plan_dispatch_activation` comptaient chacune **0 ligne**. Aucun déploiement ni changement de flag n’a eu lieu. Aucun parcours utilisateur n’a été rejoué en production. En particulier, #447 désactive la validation des corps de fonction à la création : le contrôle du catalogue atteste leur identité. La PR documente séparément leurs essais sur une base isolée.

Jusqu’au déploiement du code de #447, une confirmation de mappage seul depuis un ancien onglet qui réutilise le dernier mappage peut être invisible en base. La PR demande de différer ces confirmations pendant cette période. [Fenêtre de déploiement de la PR #447](https://github.com/maxlemeur/HEX_BC/pull/447)

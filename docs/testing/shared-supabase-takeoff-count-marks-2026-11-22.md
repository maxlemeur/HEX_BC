# Base partagée · Repères de comptage

La migration #474 a été appliquée à **17:12:23 UTC**, entre la #471 et son correctif #481. L’intervalle entre la première et la troisième version distante est de **11 secondes**. Les trois appels ont réussi à la première tentative. Les quatre tables d’activation sont vides. [Résultats détaillés](./shared-supabase-takeoff-count-marks-2026-11-22.json)

Le 22 novembre 2026, le propriétaire a explicitement autorisé les trois applications séparées, dans l’ordre #471, #474, #481, et l’intervalle pendant lequel la commande de revue existerait dans sa forme initiale.

| Migration | Version distante | Octets | SHA-256 du fichier et du SQL enregistré |
| --- | --- | ---: | --- |
| [#474](../../supabase/migrations/20261122144104_takeoff_count_marks.sql) | `20261122171223` | 125 030 | `dcae123aa4ff128a8a9f4f3c2a83d9004d3a555f5210b175861def99c0b01a14` |

Les textes enregistrés correspondent aux fichiers de `main` au commit `441c7a14e845dd643c22b01adbbf5fe10c619f0d`, saut de ligne final compris. Les 428 lignes initiales correspondaient au reçu de la #470. Les trois migrations sont les seuls ajouts et `list_migrations` confirme leur ordre parmi les 431 lignes finales. [Reçu de la #470](./shared-supabase-takeoff-item-answers-follow-up-2026-11-22.md)

## Contrôles avant application

Les deux compteurs de noms déjà pris étaient à zéro. Les tables B1, leurs fonctions de contrôle, les deux fonctions auxiliaires et `extensions.unaccent` étaient présentes. La base comptait 16 affaires, zéro réponse et zéro observation. À 17:11:57 UTC, il y avait 46 842 lignes d’audit, zéro tâche en traitement et zéro verrou concurrent sur les quatre tables ciblées. Le point de santé a répondu HTTP 200 en v0.7.0. [Point de santé](https://hex-bc.vercel.app/api/health)

## Contrôles après application

Les neuf nouvelles tables sont vides. Leurs colonnes, contraintes, index, déclencheurs d’écriture et d’immutabilité, politiques de lecture et droits correspondent au fichier. Les huit tables accessibles aux membres limitent la lecture à l’affaire. La table des reçus de commande est inaccessible aux membres. Les 28 corps de fonction ont l’empreinte du fichier. Parmi les rôles API, seul `service_role` peut appeler la publication. `authenticated` peut exécuter la commande d’édition et les quatre lecteurs. Un appel de `private.takeoff_count_unit_counts('u')` en transaction de lecture seule a renvoyé `true`, confirmant la résolution d’`unaccent`.

Les fonctions privées n’accordent aucun droit d’exécution aux rôles API et `anon` ne peut appeler aucune des fonctions contrôlées. Les 3 002 déclencheurs préexistants ont conservé leur empreinte. Sur les anciennes tables, les seuls ajouts sont les déclencheurs internes des clés étrangères des nouvelles tables. La vérification en production n’a exécuté aucune commande métier d’écriture.

## Nouveaux constats de sécurité

- **5 WARN** concernent les fonctions `SECURITY DEFINER` exécutables par `authenticated`, à savoir `edit_takeoff_count_marks`, `read_takeoff_count_mark_events`, `read_takeoff_count_mark_summaries`, `read_takeoff_count_marks`, `takeoff_count_marks_changed_since`. [Règle Supabase 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- **1 INFO** concerne la table des reçus `takeoff_count_mark_commands`. RLS y est active et aucune politique de lecture n’y est accordée aux membres. [Règle Supabase 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

# Base partagée · Décisions de revue des postes de métré

La #471 a été appliquée à **17:12:15 UTC** et son correctif #481 à **17:12:26 UTC**. L’intervalle entre la première et la troisième version distante est de **11 secondes**. Les trois appels ont réussi à la première tentative. Les quatre tables d’activation sont vides. [Résultats détaillés](./shared-supabase-takeoff-item-review-2026-11-22.json)

Le premier précontrôle a suspendu la #471 parce que sa commande de revue pouvait réutiliser des tables temporaires de la session. La #481 corrige ce point en recréant les cinq tables de travail à chaque appel. Le second précontrôle a suspendu la séquence en attendant l’accord sur l’intervalle avant cette correction. Le 22 novembre 2026, le propriétaire a explicitement autorisé les trois applications séparées, dans l’ordre #471, #474, #481, et l’intervalle pendant lequel la commande de revue existerait dans sa forme initiale.

| Migration | Version distante | Octets | SHA-256 du fichier et du SQL enregistré |
| --- | --- | ---: | --- |
| [#471](../../supabase/migrations/20261122125722_takeoff_item_review_decisions.sql) | `20261122171215` | 73 749 | `5a07546488d92fc9288ff526f570f2658cfb674b83921d365763b054e5e3b299` |
| [#481](../../supabase/migrations/20261122145415_takeoff_item_review_work_tables.sql) | `20261122171226` | 38 426 | `08044d0d6eee2f84cb597730beb72079398df067871760d3c76034eb513126ed` |

Les textes enregistrés correspondent aux fichiers de `main` au commit `441c7a14e845dd643c22b01adbbf5fe10c619f0d`, saut de ligne final compris. Les 428 lignes initiales correspondaient au reçu de la #470. Les trois migrations sont les seuls ajouts et `list_migrations` confirme leur ordre parmi les 431 lignes finales. [Reçu de la #470](./shared-supabase-takeoff-item-answers-follow-up-2026-11-22.md)

## Contrôles avant application

Les trois compteurs de la #471 étaient à zéro. Le corps de `private.takeoff_item_reading_states` avait le MD5 attendu de B1 (`5d0825ac5c143ce338a993927d37247a`). Les tables des éléments et des réponses étaient vides. À 17:11:57 UTC, il y avait 46 842 lignes d’audit, zéro tâche en traitement et zéro verrou concurrent sur les quatre tables ciblées. Le point de santé a répondu HTTP 200 en v0.7.0. [Point de santé](https://hex-bc.vercel.app/api/health)

## Contrôles après application

Les quatre nouvelles tables sont vides. Leurs colonnes, contraintes, index et déclencheurs d’écriture correspondent au fichier. Les trois tables des décisions, saisies et événements accordent aux membres la lecture dans leur affaire. Les reçus de commande restent inaccessibles aux membres. Les 17 fonctions ont les signatures, corps et droits attendus, avec le corps de la #481 pour la commande finale. `private.takeoff_item_reading_states` conserve sa signature et ses droits. Parmi les rôles API, seul `authenticated` peut exécuter la commande et les deux lecteurs.

La commande `public.review_takeoff_items(uuid,uuid,jsonb)` avait une seule signature à chaque contrôle. Le MD5 de sa définition valait `eee813445556f8bb433b285b8ea78c50` juste après la #471, puis `cb43b9a16d458075aa802d82f3ef928e` après la #481. Son propriétaire, son mode `SECURITY DEFINER` et ses droits d’exécution ont été conservés. Le corps final ne réutilise aucune table temporaire par `IF NOT EXISTS`.

Les fonctions privées n’accordent aucun droit d’exécution aux rôles API et `anon` ne peut appeler aucune des fonctions contrôlées. Les 3 002 déclencheurs préexistants ont conservé leur empreinte. Sur les anciennes tables, les seuls ajouts sont les déclencheurs internes des clés étrangères des nouvelles tables. La vérification en production n’a exécuté aucune commande métier d’écriture.

## Nouveaux constats de sécurité

- **3 WARN** concernent les fonctions `SECURITY DEFINER` exécutables par `authenticated`, à savoir `count_takeoff_item_table`, `read_takeoff_item_table`, `review_takeoff_items`. [Règle Supabase 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- **1 INFO** concerne la table des reçus `takeoff_item_review_commands`. RLS y est active et aucune politique de lecture n’y est accordée aux membres. [Règle Supabase 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

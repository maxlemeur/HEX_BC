# Base partagée · réponses aux éléments d’une liste de métré

La migration de la #461 a été appliquée le **22 novembre 2026 à 11:33:28 UTC**, au premier appel. `list_migrations` a confirmé 427 lignes. La #461 est le seul ajout aux 426 lignes vérifiées avant l’application. Les quatre tables d’activation sont vides. [Résultats détaillés](./shared-supabase-takeoff-item-answers-2026-11-22.json)

| Version distante | Octets | SHA-256 du fichier et du SQL enregistré |
| --- | ---: | --- |
| `20261122113328` | 73 313 | `edc30c089ed080fa1c80eec44b1b1728c48e8f6ec6289f0012f3f02c4aff3a4d` |

Le SQL enregistré correspond octet pour octet au fichier de `main` au commit `bb115b83fd0ac0fb8034060769bed0d410370d33`, saut de ligne final compris. La référence de départ comprend les 424 lignes du reçu de la #451, puis les versions `20261122105334` et `20261122105354` du reçu #468. Les contrôles retrouvent leurs empreintes et l’ordre des 426 migrations. [Migration](../../supabase/migrations/20261122080845_takeoff_item_answers.sql) · [Reçu de la #451](./shared-supabase-takeoff-partial-send-2026-11-22.md) · [Reçu #468](./shared-supabase-packagings-consultation-templates-2026-11-22.md)

## Avant l’application

Le précontrôle de la #461 a renvoyé cinq zéros dès la première lecture. Aucune demande ne scellait déjà une liste. La table d’activation de l’ordre des éléments était vide, les noms des nouvelles relations et fonctions étaient libres et le contrôle des sept tables a trouvé zéro verrou concurrent. [PR #461](https://github.com/maxlemeur/HEX_BC/pull/461)

À 11:33:15 UTC, la base comptait 0 tâche de métré, 0 tâche en traitement, 0 élément, 0 résultat, 0 demande de lancement et 46 772 lignes d’audit. À 11:33:18 UTC, le point de santé de production a répondu HTTP 200, version **0.7.0**, base disponible. [Point de santé](https://hex-bc.vercel.app/api/health)

## Catalogue et droits

| Table créée | Lignes | Colonnes | Contraintes | Dont clés étrangères initialement différées | Index |
| --- | ---: | ---: | ---: | ---: | ---: |
| `takeoff_item_answer_publications` | 0 | 15 | 13 | 3 | 5 |
| `takeoff_item_answers` | 0 | 25 | 27 | 2 | 9 |
| `takeoff_item_answer_observations` | 0 | 19 | 18 | 2 | 4 |

Les colonnes, contraintes et index correspondent au fichier. Chaque table active la sécurité par ligne et possède une politique de lecture pour `authenticated` qui vérifie l’accès à l’affaire. Ce rôle dispose uniquement de la lecture, limitée à 14 colonnes sur les publications pour exclure `attempt_sha256`. Chacune des trois tables porte les deux déclencheurs prévus pour contrôler les écritures directes et l’immutabilité.

Les 20 nouvelles fonctions et la fonction remplacée ont les signatures, les droits d’exécution et les empreintes de corps attendus. Le MD5 de `public.takeoff_rule_job_stamp` est passé de `1d8a241e758a2bc70c2ae8d5ce279c62` à `83c4b94756613eefd28a58ba1f8524ea`. Parmi les rôles API, seul `service_role` peut exécuter cette fonction et `publish_takeoff_item_answers`. Les 16 fonctions privées ne sont exécutables par aucun rôle API.

Les 25 déclencheurs utilisateur préexistants de `takeoff_jobs` conservent leurs définitions et leur ordre. Le nouveau déclencheur de contrainte `zz_require_takeoff_item_answers` arrive en dernier. Il est initialement différé et contrôle la publication quand une tâche rattachée à une demande de lancement passe à `completed`.

## Activation et constats de sécurité

Les tables privées `takeoff_completion_activation`, `takeoff_launch_activation`, `takeoff_item_list_order_activation` et `takeoff_plan_dispatch_activation` comptaient chacune zéro ligne avant et après l’application. Aucun déploiement ni changement de flag n’a eu lieu. La vérification en production a porté sur le catalogue, les droits et les comptages. Le parcours de publication n’a pas été exécuté.

L’advisor de sécurité a ajouté trois `WARN`, tous attendus pour les lecteurs `SECURITY DEFINER` exécutables par `authenticated`. Les fonctions concernées sont `read_takeoff_item_answers`, `read_takeoff_item_readings` et `count_takeoff_item_readings`. Ces lecteurs vérifient l’accès à l’affaire. [Règle Supabase 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

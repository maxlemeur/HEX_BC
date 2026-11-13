# TI-691 livraison 3a — reçu de la migration partagée (bons de commande depuis les demandes)

Le 12 novembre 2026, la migration des bons de commande issus des demandes de matériel a été appliquée sur la base
Supabase partagée, qui sert aussi la production. Elle a été appliquée après la fusion de sa PR et avec le go explicite
du propriétaire. Aucune donnée métier n'a été écrite pendant cette opération et ses contrôles. Le déploiement de `main`
qui a suivi, avec son propre go, est consigné [plus bas](#déploiement-et-surveillance).

Le [reçu TI-691 livraison 2](shared-supabase-ti691-delivery2-2026-11-12.md) précède ce lot dans l'historique distant.

## Source et méthode

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261112202147_material_request_purchase_orders.sql](../../supabase/migrations/20261112202147_material_request_purchase_orders.sql) | [#291](https://github.com/maxlemeur/HEX_BC/pull/291) (`61935935`) | `20261112222037` | 71 543 | 1 |

Le SHA-256 du fichier est identique à celui du SQL enregistré et à celui du manifeste :
`745126a44252f116bc14726725274d5527c3c9ca5de6408f39fcc419f1174690`.

Le fichier a été appliqué par un seul appel MCP `apply_migration`, nommé d'après son nom de fichier sans extension,
avec son contenu exact (UTF-8, fins de ligne LF, dernière fin de ligne incluse). La version distante correspond à
l'heure d'application. Aucun `db push`, aucune autre migration et aucun SQL correctif n'ont été exécutés. Les contrôles
`execute_sql` étaient en lecture seule.

## Préflight et intégrité de l'historique

Avant l'application :

- la migration était absente de l'historique ;
- les prérequis étaient présents ;
- les nouveaux objets étaient absents : colonnes, registre privé et fonctions créées ;
- les six CHECK de totaux que la migration remplace étaient présents, trois par table.

Les sept fonctions que la migration remplace avaient le `md5(prosrc)` de leur dernière définition dans les
migrations. Aucun correctif divergent n'a été écrasé.

| Fonction | `md5(prosrc)` avant | Dernière définition |
| --- | --- | --- |
| `private.validate_purchase_order_item(jsonb, boolean)` | `ce7f3bd6ff797419e562eef84d1182bc` | `20261011091744` |
| `private.normalize_purchase_order_item()` | `d3e6751ddb422c0df86b5ff739687dd7` | `20261017172127` |
| `public.create_purchase_order_draft(jsonb, jsonb)` | `8717b7b8892e17e244effdfa08b241d0` | `20261011091744` |
| `public.replace_purchase_order_draft(uuid, jsonb, jsonb, bigint)` | `c077065b94e7b0b70e7c4cd54b1c1afb` | `20261011091744` |
| `public.get_purchase_order_documents(uuid[])` | `f18fdf264009b4c574b524034623fc58` | `20261011091744` |
| `public.bulk_delete_draft_affaires(uuid, uuid[])` | `99f8a4cca80e3e2e8d2c7822b86b5adb` | `20260801153247` |
| `private.test_data_project_is_stale(uuid, integer)` | `7e72f9bb1a92cc9dfa7ec6f0ef82f093` | `20261025174800` |

L'historique comptait 393 lignes, SHA-256 `6b6c97950c3b009b5b84499eb760c8f64c47d8976ebac9cb87582d8de0087d79`, qui
est l'empreinte finale du reçu de la livraison 2. Après l'application, les 393 autres lignes ont toujours cette
empreinte.

L'historique final compte **394 lignes**, SHA-256
`e22d8332a24a4567ab126901dbf43533fb89a8f0a8d2df1e7a857599e7514220`. L'empreinte est calculée en UTF-8 par
`sha256(string_agg(version||name||array_to_string(statements,E'\n'), E'\n' order by version))`.

## Compatibilité avec la production déployée

Au moment de l'application, la production servait `1d44b253`, d'après le [reçu TI-692](shared-supabase-ti692-2026-11-12.md),
dernier déploiement enregistré. Ce code, conservé pour un éventuel retour arrière, reste compatible avec la migration :

- **Écritures des brouillons :** il appelle `create_purchase_order_draft` et `replace_purchase_order_draft` sans
  `line_kind` ni `price_per`. Les lignes prennent donc `article` et un prix pour 1, et leur total reste
  `round(quantité × prix)`.
- **Lecture des documents :** il lit `get_purchase_order_documents` par des schémas zod non stricts, qui ignorent
  les nouvelles clés.
- **Nouvelles fonctions :** il ne crée aucune commande d'affaire et n'appelle aucune des deux nouvelles fonctions.
- **Déclencheurs :** les déclencheurs sur les lignes de demande et sur le statut des commandes n'agissent que sur des
  lignes tenues par une commande, et le registre est vide.

Le code de `main` attend ces colonnes et ces fonctions : cette migration précède tout déploiement de la livraison 3a.

## Contrôles sur la base partagée

- **Commandes :**
  - `project_id` et `delivery_mode` sont présents ;
  - `delivery_site_id` accepte NULL, sous le CHECK « site ou affaire » ;
  - les CHECK du mode de livraison sont présents.
- **Lignes :**
  - `material_request_line_id`, `project_id`, `imputation`, `overhead_category` et `supply_type_id` sont présents ;
  - `line_kind` est NOT NULL, avec `'article'` par défaut ;
  - `price_per` est NOT NULL, avec 1 par défaut ;
  - leurs CHECK et leurs clés étrangères sont présents, ainsi que les quatre index partiels.
- **Totaux :**
  - les six CHECK `>= 0` ont disparu ;
  - `purchase_order_items_line_totals_sign_check` les remplace sur les lignes ;
  - le déclencheur de contrainte différable `purchase_orders_totals_not_negative` les remplace sur les commandes.
- **Données existantes :**
  - 15 commandes et 1 014 lignes ;
  - aucune commande n'a d'affaire ni de mode de livraison ;
  - aucune ligne n'a un autre type qu'`article`, un prix pour autre chose que 1, une imputation, une ligne de demande
    ou un type de fourniture ;
  - aucun total HT ne diffère de `round(quantité × prix unitaire)`.
- **Registre privé :**
  - `private.material_request_line_orders` et `private.material_request_order_receipts` existent, vides ;
  - RLS est active, sans politique ;
  - aucun privilège n'est accordé à `anon`, `authenticated` ou `service_role`.
- **Déclencheurs :** `track_material_request_line_order`, `track_material_request_order_status`,
  `zy_guard_purchase_order_affaire` et `guard_ordered_material_request_line` sont présents.
- **Fonctions :**
  - les corps des seize fonctions créées ou remplacées correspondent au fichier ;
  - toutes ont `search_path=""` ;
  - `material_request_order_summary` et `create_material_request_purchase_orders` sont SECURITY DEFINER, exécutables
    par `authenticated` seulement (pas par `anon`, PUBLIC ni `service_role`), et portent leur commentaire ;
  - les sept fonctions privées créées n'ont d'EXECUTE pour aucun de ces rôles ;
  - les fonctions remplacées gardent leurs droits et leur mode de sécurité.
- **Surcharge :** la surcharge historique `replace_purchase_order_draft(uuid, jsonb, jsonb)` existait déjà ; la
  migration n'en crée aucune.

## Avis de sécurité

`get_advisors security` a été exécuté avant et après l'application.

| Avis | Avant | Après |
| --- | ---: | ---: |
| [RLS active sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 24 INFO | 26 INFO |
| [SECURITY DEFINER accessible à authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 75 WARN | 77 WARN |
| [Protection des mots de passe divulgués désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 WARN | 1 WARN |

Les quatre nouveaux avis sont voulus par la migration :

- **Registre et reçus :** les deux tables privées n'ont aucune politique et n'accordent aucun privilège. Seules les
  fonctions SECURITY DEFINER de la migration les lisent et les écrivent.
- **Résumé et création :** les deux fonctions publiques sont SECURITY DEFINER. Une ligne commandée une fois doit être
  vérifiée contre toutes les commandes du tenant, alors qu'un membre ne voit que les siennes. Chacune contrôle les
  droits elle-même :
  - le résumé, pour les lecteurs de la demande ;
  - la création, pour ses rédacteurs qui peuvent acheter.

Les avis préexistants restent ouverts.

## Déploiement et surveillance

Le propriétaire a donné son go le 12 novembre 2026 pour déployer `main` au SHA
`2d6e9b3f93f49558b35aa112365d7b9e7637750b`, qui contient cette livraison.

- **Qualification :** `npm run check:release` sur ce SHA, code de sortie **0**, Node **26.12.1**.
  - 6 258 tests node verts et 3 ignorés, 974 tests jsdom ;
  - build Webpack, budgets de performance, runtimes PDF, XLSX et Word, smoke HTTP.
  - Sur GitHub, Quality Gate, le smoke anonyme, TesterArmy Critical, calc-v3 et Full sont verts sur ce SHA. Full
    s'est terminé après le déploiement.
- **Déploiement :** `dpl_zzL2tddZ9T97Y5CoVoLv1saCs8Kq`, **READY** à 23:18:47 UTC.
  - Il est construit depuis la source Git exacte, sans envoi de fichiers locaux, et sa ligne de clonage cite le SHA.
  - L'alias de production pointait sur lui au début de la surveillance et à 23:34:21 UTC.
- **Surveillance :** le 12 novembre, de 23:19:06 à 23:34:18 UTC, 17 passages et 33 requêtes.
  - `/login` : 16 réponses HTTP 200, formulaire présent à chaque fois.
  - `/api/health` : 15 réponses HTTP 200 avec `ok: true` et `db: up`, et **deux HTTP 503**, à 23:25:07 et
    23:25:20 UTC.
  - Le premier script s'est arrêté sur le premier 503, avant de lire `/login` à ce passage ; sa reprise a contrôlé les
    deux routes.
  - Le critère « succès à chaque passage » n'est donc pas atteint.
- **Logs :** aucun log runtime `error` ou `fatal` pour ce déploiement entre 23:13:46 et 23:34:21 UTC.
- **Drapeaux :** les trois drapeaux de production sont relevés sur le ticket TI-691. Aucune variable n'a été modifiée
  pour ce déploiement.
- **Déploiement précédent conservé :** `dpl_CsSZxB4Ryv4SPPZWcPgfYAE1HbDQ`, SHA
  `1d44b253e2fbc8085c4ffd59951265668949d78f`. Aucun retour arrière n'a été effectué.

### Les deux 503 de `/api/health`

La sonde de santé interroge la Data API Supabase et répond 503 quand la réponse n'arrive pas en 2 500 ms. Les deux 503
ont duré 2,585 et 2,595 s, soit ce délai. La sonde n'a pas changé entre `1d44b253` et `2d6e9b3f`.

Les logs du projet Supabase partagé placent la cause dans la base, pas dans le code déployé :

- **PostgREST :** à 23:25:24 UTC, une requête authentifiée de l'application reçoit `PGRST003`, « Timed out acquiring
  connection from connection pool ».
- **Connexion interne :** à 23:25:09, une connexion interne à la base met 3,2 s à établir son chiffrement.
- **PostgreSQL :** ses journaux, qui comptent une ligne toutes les une à deux secondes autour, n'en ont aucune entre
  23:24:58 et 23:25:31.

Le pool de connexions de la base partagée était saturé pendant une trentaine de secondes. Pendant ce temps, les requêtes
de l'application vers la Data API pouvaient échouer de la même façon.

Cette saturation précède le déploiement : la même erreur `PGRST003` apparaît trois fois entre 21:31 et 21:32 UTC, quand
la production servait encore `1d44b253`. Elle ne s'est pas reproduite ensuite : sept sondes entre 23:44:36 et 23:46:54
UTC ont répondu HTTP 200, `ok: true`, `db: up`. L'origine de la charge n'est pas identifiée.

### Hors de ce déploiement

- **Code :** les PR intégrées après le SHA déployé sont hors production pour ce go : #275, #288, #298, #296, #300,
  #301, #299, #304, #305, #302, #294 et #306.
- **Schéma :** la migration `20261112221835_assistant_threads`, de la PR #275, a été appliquée sur la base partagée à
  23:45:59 UTC, après cette surveillance, par une intervention distincte. Le SHA déployé n'en contient pas le code. Elle
  relève de son propre reçu.

## Limites et reprise

Les contrôles prouvent le SQL appliqué, l'historique, le catalogue, les droits, les avis et la disponibilité HTTP. Ils ne
qualifient aucun parcours métier authentifié en production : la recette authentifiée reste au propriétaire, sur un
brouillon de test. La qualification des bons de commande issus des demandes est celle de la PR #291, sur des piles
locales possédées :

- suite pgTAP, dont la course de réouverture d'une commande annulée ;
- matrice RLS ;
- parcours MR01 à MR06, BIZ02 et achats décimaux.

Preuves privées locales, non versionnées : `outputs/production-2d6e9b3f-20261112/` et
`outputs/check-release-2d6e9b3f/`. Ce reçu publie uniquement les identités techniques et les résultats assainis.

Ce reçu est documentaire : cohérence, liens et `git diff --check` seulement. Son annulation n'annule ni la migration ni
le déploiement. Privilégier une correction compatible en avant. Toute intervention distante supplémentaire nécessite sa
propre autorisation.

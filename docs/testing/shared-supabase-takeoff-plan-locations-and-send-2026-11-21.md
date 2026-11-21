# Base partagée · emplacements de plan et envois takeoff du 21 novembre 2026

**B et M2 ont été appliquées et vérifiées.** B a enregistré la source des 15 fichiers de plan existants. M2 a été appliquée à 10:29:41 UTC sous la v0.7.0, sur décision du propriétaire. L’historique compte 417 lignes. [Résultats détaillés](./shared-supabase-takeoff-plan-locations-and-send-2026-11-21.json)

## Identité de B et historique

La [migration des emplacements de plan](../../supabase/migrations/20261121040445_takeoff_plan_locations.sql) provient de la [PR #429](https://github.com/maxlemeur/HEX_BC/pull/429), fusionnée au commit `10859bced`. La source a été vérifiée sur `origin/main` au commit `0dcea6a2f86a0cd9b61058334764eaf2964545cc`.

| Application UTC | Version distante | Octets | SHA-256 commun au fichier, au manifeste et au SQL enregistré |
| --- | --- | ---: | --- |
| 21 novembre, 08:34:06 | `20261121083406` | 37 942 | `a88febeb429035374fb0d6fa869cc668634ec4e39cdc75d6075a0be0367c487b` |

Le SQL enregistré contient le fichier complet, y compris son dernier LF. Après B, l’historique comptait **416 lignes**. Les 415 couples version/nom initiaux sont identiques. Les empreintes des 407 premières lignes, du SQL de la ligne 408 et de chacune des sept migrations du matin correspondent au [reçu de référence](./shared-supabase-v080-and-takeoff-lot2-2026-11-21.md). B est la seule ligne supplémentaire.

## Contrôles de B

- **Avant.** Les quatre indicateurs de la PR étaient vrais : M1 présente, clés de portée du jeu de plans et du projet présentes, quatre noms de tables libres. Sur 15 fichiers à enregistrer, 0 sans source identifiable. À 08:34:02 UTC, aucune autre session ne détenait ni n’attendait de verrou sur les trois tables contrôlées. L’application a réussi au premier appel.
- **Après.** Les 15 fichiers ont chacun exactement une ligne dans le registre. Le contrôle du tenant, de l’affaire, du jeu de plans et du type et de l’identifiant de source a renvoyé 0 écart. Les tables des corrections, des événements et des attestations comptaient chacune 0 ligne. La table d’activation des avis était vide.
- **Catalogue.** Les quatre tables, leurs colonnes, contraintes et index, les trois déclencheurs et les huit corps de fonction ont été contrôlés. Chacune des trois tables publiques a la RLS activée et une politique de lecture pour les lecteurs de l’affaire. Le rôle authentifié dispose de SELECT sur ces tables. La table privée des attestations ne donne aucun droit de table aux rôles API. Les privilèges d’exécution et les empreintes MD5 de chaque fonction figurent dans le JSON.
- **Advisor de sécurité.** Deux nouveaux WARN concernent des fonctions `SECURITY DEFINER` exécutables par `authenticated` : `public.read_takeoff_plan_location_source` et `public.set_takeoff_plan_location`. Cette catégorie passe de 85 à 87 constats. [Fiche de l’advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

## Identité et application de M2

La migration des reçus d’envoi provient de la PR #426, fusionnée au commit `0dcea6a2f`. Son empreinte sur `origin/main` au commit `4343a80c57ed8e460c9ec7f2bc9823ddd7a295eb` correspond au manifeste et au SQL enregistré, dernier LF compris. [Migration M2](../../supabase/migrations/20261121050138_takeoff_send_receipts.sql) · [PR #426](https://github.com/maxlemeur/HEX_BC/pull/426)

| Application UTC | Version distante | Octets | SHA-256 |
| --- | --- | ---: | --- |
| 21 novembre, 10:29:41 | `20261121102941` | 110 977 | `b740982809201eb4c59b0e6c62d7c312649e4c6703025095716d4f2bdca371af` |

Le premier contrôle à 08:35:35 UTC avait relevé la v0.7.0 et M2 avait été différée. À 10:29:24 UTC, juste avant l’application, un GET sur l’alias public de production a renvoyé HTTP 200 et `{"ok":true,"version":"0.7.0","db":"up"}`. Le propriétaire a choisi l’option 2, appliquer M2 sous cette version. L’écran de la v0.7.0 propose encore de fusionner une quantité de métré sur une ligne de devis saisie à la main. Avec M2, cette opération peut renvoyer HTTP 409 avec le message « Conflit lors de l'application du job takeoff. » et aucune écriture. La v0.8.0 est la première version qui bloque cette fusion à l’écran. [Point de santé de production](https://hex-bc.vercel.app/api/health)

## Contrôles de M2

- **Avant l’application.** Les 16 indicateurs de la PR étaient vrais. Les noms des objets à créer étaient libres. Les corps existants de `persist_estimate_creation_atomic` et `apply_takeoff_job_atomic` avaient les empreintes exigées par la PR. À 10:29:23 UTC, la base comptait 0 tâche de métré, tous statuts confondus, et 0 verrou d’une autre session sur `takeoff_jobs`, `estimate_versions`, `estimate_projects` ou `tenants`. Les contraintes et index uniques de M2 portent sur des tables neuves, d’où 0 ligne préexistante en infraction.
- **Historique et données.** L’application a réussi au premier appel. Les 416 couples version/nom précédents et leurs empreintes de référence ont été revérifiés. M2 est la seule ligne ajoutée. Les tables `public.takeoff_send_receipts`, `private.takeoff_send_commands`, `private.takeoff_job_attachment_permits` et `private.takeoff_completion_activation` comptaient chacune 0 ligne après l’application.
- **Catalogue.** Les trois tables totalisent 29 colonnes, 21 contraintes et 6 index. Les deux déclencheurs de protection des reçus sont actifs. La table publique des reçus a la RLS activée et une politique de lecture pour `authenticated`, limité à SELECT. Les deux tables privées n’accordent aucun droit de table aux rôles API. La politique de lecture des tâches inclut désormais le contrôle d’accès aux tâches envoyées.
- **Fonctions de la v0.7.0.** Les 18 corps de fonction définis par M2 ont l’empreinte MD5 du fichier. L’ancien corps de `apply_takeoff_job_atomic(uuid,text,uuid,jsonb)` est conservé sous `private.takeoff_apply_atomic_writer`, avec la même signature et les droits d’exécution retirés aux rôles API. Le point d’entrée `public.apply_takeoff_job_with_page_decisions(uuid,text,uuid,jsonb,jsonb,text)` passe toujours par `apply_takeoff_job_guarded_atomic`, puis par la signature publique de `apply_takeoff_job_atomic`. Les signatures de `public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)` et `public.takeoff_rule_version_stamp(uuid,uuid)` ont également été vérifiées.
- **Advisor de sécurité.** Un nouveau WARN concerne `public.send_takeoff_job(jsonb)`, une fonction `SECURITY DEFINER` exécutable par `authenticated`. Cette catégorie passe de 87 à 88 constats. [Fiche de l’advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

La vérification en production a porté sur le catalogue, les compteurs et le point de santé. Le parcours de fusion et son HTTP 409 n’ont pas été rejoués sur la base partagée. Les avis restent inactifs. Aucun déploiement ni changement de flag n’a eu lieu.

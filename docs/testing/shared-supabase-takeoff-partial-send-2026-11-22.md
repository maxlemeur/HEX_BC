# Base partagée · envoi partiel d’un plan de métré

La migration de la PR #451 a été appliquée et vérifiée le **22 novembre 2026 à 08:49:03 UTC**. L’historique est passé de 423 à 424 lignes. Les quatre tables d’activation sont vides. [Résultats détaillés](./shared-supabase-takeoff-partial-send-2026-11-22.json)

| Version distante | Octets | SHA-256 du fichier et du SQL enregistré |
| --- | ---: | --- |
| `20261122084903` | 98 334 | `7893a5f2523e6fdc6a39740918aabb6e963124d0cc78edf1bf167e40f16d36e9` |

L’application a réussi au premier appel. Le SQL enregistré correspond octet pour octet au fichier de `main` au commit `344760ae59be3571ddf1eecf3f03ee577a268743`, dernier saut de ligne compris. Le contrôle de l’historique retrouve les empreintes de référence et les 423 couples version/nom précédents dans le même ordre. La #451 est le seul ajout. [Migration](../../supabase/migrations/20261122030312_takeoff_partial_send.sql) · [Reçu précédent](./shared-supabase-takeoff-exclusion-item-lists-dispatcher-2026-11-22.md)

## Avant l’application

La requête de la PR a renvoyé `0 | 0 | false` : aucune activation de la répartition par plan, aucune analyse par plan déjà rattachée à une version de devis, et table de contrôle absente. Les noms des sept fonctions à créer étaient libres. Les trois signatures à remplacer existaient. [PR #451](https://github.com/maxlemeur/HEX_BC/pull/451)

À 08:48:56 UTC, la base comptait 0 tâche de métré, 0 tâche en traitement, 0 demande admise, 0 reçu d’envoi et 46 772 lignes d’audit. Le point de santé public a répondu HTTP 200 avec la version **0.7.0** et la base disponible. [Point de santé](https://hex-bc.vercel.app/api/health)

## Après l’application

- Les dix corps de fonction (sept créations, trois remplacements) ont le MD5 attendu. Les signatures, propriétaires et droits ont été vérifiés. Parmi les rôles API, seul `service_role` peut exécuter `public.read_takeoff_send_context` et `public.read_takeoff_send_drift`. Les huit fonctions privées n’accordent aucun droit d’exécution aux rôles API.
- La table privée `takeoff_plan_send_checks` comptait 0 ligne. Elle possède trois colonnes, une clé primaire sur `job_id` et aucune clé étrangère. Seul `postgres` dispose de droits sur la table.
- Le nombre et l’empreinte des définitions des 2 925 déclencheurs sont identiques avant et après l’application. Les 25 déclencheurs utilisateur de `takeoff_jobs` conservent leurs noms et leur ordre.
- Les tables privées `takeoff_completion_activation`, `takeoff_launch_activation`, `takeoff_item_list_order_activation` et `takeoff_plan_dispatch_activation` comptaient chacune 0 ligne. L’advisor de sécurité n’a relevé aucun nouveau constat.

Aucun déploiement ni changement de flag n’a eu lieu. Le contrôle en production a porté sur l’identité du SQL, le catalogue, les droits et les comptages. Le parcours d’envoi partiel n’a pas été exécuté sur la base partagée.

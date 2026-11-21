# Base partagée · lignes de métré groupées et contributions du 21 novembre 2026

**La migration de la PR #434 a été appliquée et vérifiée à 11:23:55 UTC.** L’historique est passé de 417 à 418 lignes. Aucun nouveau constat de sécurité n’est apparu. [Résultats détaillés](./shared-supabase-takeoff-send-followup-2026-11-21.json)

## Identité et historique

Le fichier de la PR #434 était la seule migration manquante sur `origin/main`, au commit `0c24ac99ec47f73f7ed93cc25531432c41624502`. L’application a réussi au premier appel. Le SQL enregistré correspond au fichier Git et au manifeste, dernier saut de ligne compris. [Migration](../../supabase/migrations/20261121085058_takeoff_send_grouped_lines_and_parts.sql) · [PR #434](https://github.com/maxlemeur/HEX_BC/pull/434)

| Application UTC | Version distante | Octets | SHA-256 |
| --- | --- | ---: | --- |
| 21 novembre, 11:23:55 | `20261121112355` | 99 174 | `dddbaaf69c7818e310b20f14b7af506fe85e6cb2d81fba4387cc5295c2e33c56` |

Les 417 couples version/nom de départ sont restés identiques et dans le même ordre. L’empreinte cumulée des 407 premières lignes et les empreintes SQL des dix suivantes correspondaient au reçu précédent, qui se termine par M2 (`20261121102941`). [Reçu de M2](./shared-supabase-takeoff-plan-locations-and-send-2026-11-21.md)

## Avant l’application

Les sept fonctions à remplacer existaient avec les signatures listées ci-dessous. Les noms des trois fonctions et de la table à créer étaient libres. À 11:23:50 UTC, aucune autre session ne détenait ni n’attendait de verrou sur `takeoff_send_receipts`, `takeoff_jobs`, `estimate_items`, `estimate_versions` ou `estimate_projects`.

| Contrôle | Nombre |
| --- | ---: |
| Reçus d’envoi | 0 |
| Commandes d’envoi en attente | 0 |
| Tâches de métré | 0 |
| Lignes de devis dont les parts diffèrent des sources actives, selon la requête de la PR | 0 |

## Catalogue après l’application

Les dix signatures et les dix empreintes MD5 des corps de fonction correspondent au fichier. Les sept fonctions remplacées ont conservé leur propriétaire, leurs arguments, leur type de retour et leurs droits d’exécution. Toutes appartiennent à `postgres`.

| Signature | Opération | Rôle API autorisé à exécuter |
| --- | --- | --- |
| `private.finalize_takeoff_lengths(uuid,integer,integer,integer,uuid[],text,jsonb,jsonb)` | Remplacement | Aucun |
| `private.takeoff_line_parts(uuid[],jsonb,uuid)` | Création | Aucun |
| `private.takeoff_replace_pages(uuid,uuid,uuid,jsonb,uuid[])` | Remplacement | Aucun |
| `private.takeoff_send_admitted_role(jsonb,uuid,uuid,uuid,uuid)` | Remplacement | Aucun |
| `private.takeoff_send_execute(uuid,uuid,public.tenant_role,uuid,jsonb,boolean)` | Remplacement | Aucun |
| `private.takeoff_send_receipt_effects_of(uuid)` | Création | Aucun |
| `public.complete_takeoff_send_effects(uuid,text)` | Création | `service_role` |
| `public.stage_takeoff_send(uuid,jsonb)` | Remplacement | `service_role` |
| `private.takeoff_send_replay(public.takeoff_send_receipts,uuid,uuid,text,text)` | Remplacement | Aucun |
| `public.send_takeoff_job(jsonb)` | Remplacement | `authenticated` |

La nouvelle table privée `private.takeoff_send_receipt_effects` comptait **0 ligne**. Sa clé primaire `receipt_id` référence `public.takeoff_send_receipts(id)` avec suppression en cascade. La contrainte sur `command_format` impose 1 ou 2. Les trois autres colonnes acceptent NULL et enregistrent le propriétaire de l’affaire et les dates d’achèvement. Les trois contraintes sont validées. La RLS est désactivée et seul `postgres` dispose de droits sur la table.

## Sécurité et périmètre

L’advisor de sécurité a été comparé constat par constat avant et après la migration. Aucun constat ajouté ou retiré. La table d’activation des avis comptait toujours 0 ligne. Aucun déploiement ni changement de flag n’a eu lieu. La vérification a porté sur l’historique, le catalogue et les comptages. Aucun parcours d’envoi ou de reprise n’a été exécuté en production.

# Base partagée · emplacements de plan et envois takeoff du 21 novembre 2026

**Une migration appliquée et vérifiée sur deux.** B a enregistré une source pour chacun des 15 fichiers de plan existants. M2 reste en attente de la v0.8.0 ou d’une version ultérieure en production. Aucun déploiement, changement de flag ou activation des avis n’a eu lieu. [Résultats détaillés](./shared-supabase-takeoff-plan-locations-and-send-2026-11-21.json)

## Identité de B et historique

La [migration des emplacements de plan](../../supabase/migrations/20261121040445_takeoff_plan_locations.sql) provient de la [PR #429](https://github.com/maxlemeur/HEX_BC/pull/429), fusionnée au commit `10859bced`. La source a été vérifiée sur `origin/main` au commit `0dcea6a2f86a0cd9b61058334764eaf2964545cc`.

| Application UTC | Version distante | Octets | SHA-256 commun au fichier, au manifeste et au SQL enregistré |
| --- | --- | ---: | --- |
| 21 novembre, 08:34:06 | `20261121083406` | 37 942 | `a88febeb429035374fb0d6fa869cc668634ec4e39cdc75d6075a0be0367c487b` |

Le SQL enregistré contient le fichier complet, y compris son dernier LF. L’historique final compte **416 lignes**. Les 415 couples version/nom initiaux sont identiques. Les empreintes des 407 premières lignes, du SQL de la ligne 408 et de chacune des sept migrations du matin correspondent au [reçu de référence](./shared-supabase-v080-and-takeoff-lot2-2026-11-21.md). B est la seule ligne supplémentaire.

## Contrôles de B

- **Avant.** Les quatre indicateurs de la PR étaient vrais : M1 présente, clés de portée du jeu de plans et du projet présentes, quatre noms de tables libres. Sur 15 fichiers à enregistrer, 0 sans source identifiable. À 08:34:02 UTC, aucune autre session ne détenait ni n’attendait de verrou sur les trois tables contrôlées. L’application a réussi au premier appel.
- **Après.** Les 15 fichiers ont chacun exactement une ligne dans le registre. Le contrôle du tenant, de l’affaire, du jeu de plans et du type et de l’identifiant de source a renvoyé 0 écart. Les tables des corrections, des événements et des attestations comptaient chacune 0 ligne. La table d’activation des avis était vide.
- **Catalogue.** Les quatre tables, leurs colonnes, contraintes et index, les trois déclencheurs et les huit corps de fonction ont été contrôlés. Chacune des trois tables publiques a la RLS activée et une politique de lecture pour les lecteurs de l’affaire. Le rôle authentifié dispose de SELECT sur ces tables. La table privée des attestations ne donne aucun droit de table aux rôles API. Les privilèges d’exécution et les empreintes MD5 de chaque fonction figurent dans le JSON.
- **Advisor de sécurité.** Deux nouveaux WARN concernent des fonctions `SECURITY DEFINER` exécutables par `authenticated` : `public.read_takeoff_plan_location_source` et `public.set_takeoff_plan_location`. Cette catégorie passe de 85 à 87 constats. [Fiche de l’advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

## M2 en attente du déploiement

À 08:35:35 UTC, un GET sur le point de santé de l’alias public de production a répondu **HTTP 200** avec `{"ok":true,"version":"0.7.0","db":"up"}`. La v0.8.0 est la première version dont l’écran refuse la fusion d’une quantité takeoff sur une ligne de devis saisie à la main avant l’envoi. En v0.7.0, l’écran propose encore cette opération : avec M2 en base, elle peut aboutir à un HTTP 409. L’application de M2 est donc différée. Ses contrôles opérationnels et la qualification applicative en production restent à faire. [Point de santé](https://hex-bc.vercel.app/api/health) · [Ordre de livraison de la PR #426](https://github.com/maxlemeur/HEX_BC/pull/426)

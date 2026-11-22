# Base partagée · contrôles des réponses de métré avant activation

La migration de la #470 a été appliquée et vérifiée le **22 novembre 2026 à 13:55:50 UTC**, au premier appel. L’historique est passé de **427 à 428 lignes**. Les quatre tables d’activation sont vides. [Résultats détaillés](./shared-supabase-takeoff-item-answers-follow-up-2026-11-22.json)

| Version distante | Taille en octets | SHA-256 du fichier et du SQL enregistré |
| --- | ---: | --- |
| `20261122135550` | 17 897 | `a658655855554711c724e5e1fd98cf0228013d591946a8c5f33ba8f93e641410` |

Le SQL enregistré correspond octet pour octet au fichier de `main` au commit `b661b3d8293cd297dc056a6123ecf85ffaef5894`, saut de ligne final compris. Avant l’application, les 427 lignes correspondaient au reçu de la #461. Après l’application, la comparaison des empreintes historiques et des couples version/nom renvoyés par `list_migrations` confirme que la #470 est le seul ajout. [Migration](../../supabase/migrations/20261122113611_takeoff_item_answers_before_activation.sql) · [Reçu de la #461](./shared-supabase-takeoff-item-answers-2026-11-22.md)

## Avant l’application

Le précontrôle de la PR a donné zéro pour chacun des trois compteurs (lignes d’activation de l’ordre de lecture par liste, demandes scellant une liste et publications de réponses). À 13:55:39 UTC, aucune tâche de métré n’était en traitement. Le point de santé de production a répondu HTTP 200 avec la version **0.7.0** et la base disponible. [PR #470](https://github.com/maxlemeur/HEX_BC/pull/470) · [Point de santé](https://hex-bc.vercel.app/api/health)

## Fonctions et catalogue

| Fonction | MD5 du corps avant | MD5 du corps après |
| --- | --- | --- |
| `private.assert_takeoff_launch_order` | `3e37e7de665a378696021b0897acaf4c` | `9aabd027a5dfee255a5caecfd011200d` |
| `private.takeoff_item_answers_refusal` | `fb0a54ae56dc16d3f98c4a462b85bfc5` | `fb0a54ae56dc16d3f98c4a462b85bfc5` |
| `public.publish_takeoff_item_answers` | `83888ec0430a3c72925bf9899285ae19` | `163aac2c23b43f5af0fb12fff9e105e2` |

Les corps initiaux de `publish_takeoff_item_answers` et de `assert_takeoff_launch_order` correspondent respectivement aux migrations `20261122080845` et `20261121230719`. Les deux nouveaux corps correspondent au fichier de la #470. Le corps de `takeoff_item_answers_refusal` est identique avant et après.

Les trois signatures, les types de retour, le propriétaire `postgres`, le mode `SECURITY DEFINER`, le `search_path` vide et les droits d’exécution ont été vérifiés avant et après. Parmi les rôles API, seul `service_role` peut exécuter la publication. Aucun rôle API ne peut exécuter les deux fonctions privées. Les instructions `REVOKE` et `GRANT` du fichier réaffirment les droits déjà en place.

Les nombres et les empreintes des relations, colonnes, contraintes, index, politiques, droits et déclencheurs comparés sont identiques. Les 26 déclencheurs utilisateur de `takeoff_jobs` conservent leurs noms et leur ordre. Les trois tables de publications, réponses et observations comptent chacune zéro ligne.

## Activation et sécurité

Les tables privées `takeoff_completion_activation`, `takeoff_launch_activation`, `takeoff_item_list_order_activation` et `takeoff_plan_dispatch_activation` comptent chacune zéro ligne avant et après. L’advisor de sécurité n’a relevé aucun nouveau constat. Aucun déploiement ni changement de flag n’a eu lieu.

La vérification en production porte sur le SQL enregistré, les métadonnées et les comptages. Les fonctions de publication et de validation d’une demande n’ont pas été exécutées sur la base partagée.

# TI-691 — reçu des deux migrations d'envoi sur la base partagée (e-mail redirigé, envoi des bons)

Les deux migrations d'envoi de TI-691 sont dans l'historique de la base Supabase partagée, qui sert aussi la
production. Elles y ont été appliquées le 14 novembre 2026, chacune sur le go explicite du propriétaire, par deux
interventions distinctes de ce reçu. Ce reçu en vérifie l'identité et l'effet le 15 novembre 2026, en lecture seule :
aucune donnée, aucun objet et aucune ligne d'historique n'ont été écrits pour l'établir. Aucun déploiement n'a été
fait.

## Source et identité

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261114133955_estimate_email_redirected.sql](../../supabase/migrations/20261114133955_estimate_email_redirected.sql) | [#348](https://github.com/maxlemeur/HEX_BC/pull/348) (`0b129c91`) | `20261114144747` | 3 117 | 1 |
| [20261114121243_purchase_order_sends.sql](../../supabase/migrations/20261114121243_purchase_order_sends.sql) | [#342](https://github.com/maxlemeur/HEX_BC/pull/342) (`54f6dae0`) | `20261114154038` | 29 389 | 1 |

Chaque ligne d'historique porte le nom du fichier sans extension. Pour chacune, trois SHA-256 sont égaux : celui du
fichier sur `main`, celui du [manifeste](../../supabase/migrations.manifest.json) et celui du SQL enregistré
(`sha256(array_to_string(statements, E'\n'))`) :

- `estimate_email_redirected` : `4b6213dc2868ba41927618392b1969fc5db273d6da687376fbda1060739f7ab6` ;
- `purchase_order_sends` : `58a1e571f5bdf62f805f4359955efa769141ec14a543818e06837cf2183a4d83`.

L'historique compte **407 lignes**. Les 404 lignes antérieures à `20261113234337` gardent le SHA-256
`b950ea8466351a6fe062c758147fcea4d8b50844fcfcf1660bcf956629e6a437` du [reçu TI-728](shared-supabase-ti728-2026-11-14.md),
calculé de la même façon. Après la ligne de TI-728, seules ces deux lignes se sont ajoutées.

## Deux écarts à la procédure

- **Avant la fusion.** `estimate_email_redirected` a été appliquée à 14:47:47 UTC, une minute avant la fusion de sa PR
  (14:48:49 UTC). Le fichier fusionné est octet pour octet celui qui a été appliqué (SHA-256 ci-dessus) : l'écart est
  sans effet sur le schéma.
- **Hors de l'ordre des fichiers.** `purchase_order_sends`, le fichier le plus ancien des deux, a été appliquée en
  second, à 15:40:38 UTC, après la fusion de sa PR (13:23:55 UTC). Les deux migrations sont indépendantes : la première
  ne touche que `public.estimate_emails`, la seconde que les bons de commande, et aucune ne lit un objet de l'autre.

## Effet sur le catalogue

Les six fonctions ont le corps du fichier : `md5(prosrc)` est égal au md5 du texte entre les délimiteurs `$$`.

| Fonction | md5 du corps | Caractères | Exécution | `EXECUTE` |
| --- | --- | ---: | --- | --- |
| `public.guard_estimate_email_redirected()` | `1eb763da44e06c84685e72eff232a50e` | 769 | INVOKER | `service_role` |
| `private.guard_purchase_order_lifecycle()` | `3e021ce339b8ed9f5ac9182888b2d7dd` | 1 401 | INVOKER | aucun des trois rôles |
| `public.confirm_material_request_purchase_order(uuid,bigint,jsonb)` | `cf7ca771a880c43f3d45b31cea6644ef` | 8 833 | DEFINER | `authenticated` |
| `private.purchase_order_send_json(purchase_order_sends)` | `a8b7bc810daa9c6cb2d2aed1cf830ffa` | 53 | INVOKER | aucun des trois rôles |
| `public.begin_purchase_order_send(uuid,bigint,jsonb)` | `1fd6094f35f221941f0d8fe800054519` | 4 679 | DEFINER | `authenticated` |
| `public.finish_purchase_order_send(uuid,jsonb)` | `ab3d165f30f4595bbc3e533b22d3780c` | 3 173 | DEFINER | `service_role` |

Les trois rôles regardés sont `anon`, `authenticated` et `service_role`. Toutes ont un `search_path` vide, et aucune
n'est exécutable par PUBLIC.

**E-mail redirigé (`estimate_email_redirected`).**

- `public.estimate_emails.redirected` existe : `boolean`, nullable, avec le commentaire du fichier (md5
  `063b6c13deda03576b0e2cecbb4a98dc`).
- Le déclencheur `guard_estimate_email_redirected` est actif, `BEFORE UPDATE … FOR EACH ROW`.
- `public.estimate_emails` ne compte aucune ligne : la migration n'a rien eu à marquer.

**Envoi des bons (`purchase_order_sends`).**

- `public.purchase_order_sends` existe, vide, avec ses quatre index : la clé primaire,
  `purchase_order_sends_one_in_flight_idx`, `purchase_order_sends_order_idx` et `purchase_order_sends_tenant_idx`.
- RLS est activée, avec une seule politique, « Readers of an order read its sends », en lecture pour `authenticated`.
- Droits de table : `SELECT` pour `authenticated`, rien pour `anon`. Un membre n'écrit donc que par les deux
  fonctions.
- Les deux fonctions remplacées ne diffèrent de leur définition précédente
  ([20261113190113](../../supabase/migrations/20261113190113_material_request_order_confirmation.sql)) que par les
  lignes marquées « Envoi » :
  - le garde n'accepte brouillon → envoyée que par le règlement d'un envoi (`PURCHASE_ORDER_SEND_THROUGH_FUNCTION`) ;
  - la confirmation accepte aussi un bon envoyé, qu'elle remet en brouillon dans la même transaction.

  Aucune transition acceptée auparavant n'est retirée. Brouillon → envoyée à la main, déjà refusée pour un bon
  d'affaire, l'est toujours, sous un autre code (`42501` au lieu de `23514`).

## Advisor de sécurité

L'advisor du 15 novembre 2026 montre les trois mêmes catégories qu'au [reçu TI-728](shared-supabase-ti728-2026-11-14.md),
sans aucun niveau ERROR :

- `authenticated_security_definer_function_executable` (WARN) passe de 80 à 81 fonctions. Deux des fonctions ci-dessus y
  figurent : `confirm_material_request_purchase_order`, qui y était déjà avec les mêmes droits, et
  `begin_purchase_order_send`, qui est donc l'ajout. C'est le modèle voulu : elle vérifie elle-même les droits de
  modification du bon (`private.purchase_order_access`).
- `rls_enabled_no_policy` (INFO, 26) et `auth_leaked_password_protection` (WARN, 1) sont inchangées. Ni
  `purchase_order_sends` ni `estimate_emails` n'y figure.

## Qualification et limites

La qualification est celle des PR #342 et #348, sur des piles locales possédées, dont
[purchase-order-sends.test.sql](../../supabase/tests/database/purchase-order-sends.test.sql) et
[estimate-email-redirected.test.sql](../../supabase/tests/database/estimate-email-redirected.test.sql). Rien n'a été
rejoué pour ce reçu.

Ce reçu ne prouve que l'application et l'état du schéma, et ne qualifie aucun parcours en production. Le dernier
déploiement enregistré, `6f87d328` ([reçu du 13/11](shared-supabase-main-catchup-2026-11-13.md)), ne contient ni
l'envoi des bons ni la marque des e-mails redirigés : les deux migrations précèdent leur code. Deux conséquences d'ici
le prochain déploiement :

- un bon passé « Envoyée » depuis un serveur local branché sur cette base est lu par la production, dont l'écran ne
  propose « Confirmer la commande… » que sur un brouillon : il faut d'abord le remettre en brouillon, ce que cet écran
  permet ;
- avant ce déploiement, `EMAIL_REDIRECT_TO` doit être défini chez l'hébergeur, sinon tout envoi est refusé
  ([redirection](email-redirection.md)).

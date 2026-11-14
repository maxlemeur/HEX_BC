# TI-691 envois redirigés — reçu de la migration partagée

La migration qui note si un e-mail de devis a été redirigé vers la boîte de test est dans l'historique de la base
Supabase partagée, qui sert aussi la production. Elle y a été appliquée le 14 novembre 2026 à 14:47:47 UTC, sur le go
explicite du propriétaire (« Apply now »), **avant la fusion de sa PR** [#348](https://github.com/maxlemeur/HEX_BC/pull/348),
dont elle est le commit `090a0fbc`. Son nom est donc figé : si une migration plus récente arrive sur `main` avant #348,
celle-ci ne peut plus être restampée, et c'est l'autre qui doit l'être.

## Source et identité

| Fichier | PR | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261114133955_estimate_email_redirected.sql](../../supabase/migrations/20261114133955_estimate_email_redirected.sql) | [#348](https://github.com/maxlemeur/HEX_BC/pull/348) (`090a0fbc`) | `20261114144747` | 3 117 | 1 |

La ligne d'historique porte le nom du fichier sans extension. Trois SHA-256 sont égaux : celui du fichier, celui du
[manifeste](../../supabase/migrations.manifest.json) et celui du SQL enregistré
(`sha256(array_to_string(statements, E'\n'))`) :
`4b6213dc2868ba41927618392b1969fc5db273d6da687376fbda1060739f7ab6`.

Avant l'application, l'historique comptait 405 lignes, la plus récente `20261113224854_takeoff_apply_dpgf_check_under_lock`.
L'empreinte des lignes antérieures
(`sha256(string_agg(version || name || array_to_string(statements, E'\n'), E'\n' order by version))`) vaut
`cf58de07d7894d8cd25dced1baddf6cb609dbf14388dcac0070b69d20895e269` avant et après : aucune autre ligne n'a changé.
La migration de [#342](https://github.com/maxlemeur/HEX_BC/pull/342) (`20261114121243_purchase_order_sends`) n'est pas
appliquée : celle-ci n'en dépend pas et la précède dans l'historique distant.

## Effet sur le catalogue

- **Colonne :** `public.estimate_emails.redirected`, `boolean`, nullable, sans défaut. La table comptait 0 ligne : aucune
  donnée n'a été réécrite.
- **Garde :** `public.guard_estimate_email_redirected()`, SECURITY INVOKER, `search_path` vide, exécutable ni par `anon`
  ni par `authenticated` ; déclencheur `guard_estimate_email_redirected` (BEFORE UPDATE) actif, après
  `aaa_guard_estimate_email_pdf_publication` et `guard_estimate_email_dispatch_mutation`.
- **Droits :** `authenticated` lit la colonne et ne l'écrit pas ; RLS activée et forcée sur la table, comme avant.

## Advisor de sécurité

Identique avant et après, finding par finding : `rls_enabled_no_policy` (INFO, 26),
`authenticated_security_definer_function_executable` (WARN, 80), `auth_leaked_password_protection` (WARN, 1).

## Qualification et limites

La qualification est celle de #348, sur des piles locales possédées : pgTAP
[estimate-email-redirected.test.sql](../../supabase/tests/database/estimate-email-redirected.test.sql) écrit avant la
migration (rouge, puis 31/31), `db:ci:local` complet, phases calc-v3 `emission-redirect`, `emission`, `resend-portal`,
`verify:pr`.

Le code déployé en production ne lit ni n'écrit cette colonne, et aucune de ses écritures sur `estimate_emails` ne la
change : la migration lui est sans effet. Le code qui l'utilise arrive avec #348 ; son déploiement relève de son propre
reçu, et exige `EMAIL_REDIRECT_TO` chez l'hébergeur. Ce reçu ne qualifie aucun parcours en production.

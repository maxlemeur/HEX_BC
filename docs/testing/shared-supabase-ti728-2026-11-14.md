# TI-728 sur la base partagée : reçu du 14 novembre 2026

Le 13 novembre 2026 à 23:43:37 UTC (le 14 à 00:43 à Paris), la migration de TI-728 a été appliquée sur la base Supabase
partagée, qui sert aussi la production. Elle l'a été après la fusion de sa PR et avec le go explicite du propriétaire.
Aucune donnée métier n'a été écrite par l'application ou par ses contrôles, et aucun déploiement n'a été fait.

## Source et méthode

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261113224854_takeoff_apply_dpgf_check_under_lock.sql](../../supabase/migrations/20261113224854_takeoff_apply_dpgf_check_under_lock.sql) | [#330](https://github.com/maxlemeur/HEX_BC/pull/330) (`f9e180b7`) | `20261113234337` | 9 512 | 1 |

Trois SHA-256 sont égaux, `06a65ebc825fac0b72e87c70cc2dd3b748d49302b2d54911fc1d19fb53d6d379` :
- celui du fichier sur `origin/main` ;
- celui du [manifeste](../../supabase/migrations.manifest.json) ;
- celui du SQL enregistré, `sha256(array_to_string(statements, E'\n'))`.

Le fichier a été appliqué par un seul appel MCP `apply_migration`. L'appel porte le nom du fichier sans son extension,
et son contenu exact : UTF-8, fins de ligne LF, dernière fin de ligne incluse, sans tabulation ni espace de fin de
ligne, et les seuls caractères non ASCII sont des guillemets « ». La version distante correspond à l'heure
d'application. Aucun `db push` ni aucun SQL correctif n'a été exécuté, et les contrôles `execute_sql` étaient en
lecture seule.

## Avant l'application

- Les deux migrations qui la précèdent sont dans l'historique :
  - `20261113211347_takeoff_dpgf_section_replace` (TI-726), en version `20261113232033` ;
  - `20261113220931_affaire_supply_cost` (TI-691), en version `20261113232105`.
- La migration elle-même n'y était pas encore.
- L'historique comptait **404 lignes**, de SHA-256 `b950ea8466351a6fe062c758147fcea4d8b50844fcfcf1660bcf956629e6a437`.
- La surcharge à 4 arguments `public.apply_takeoff_job_guarded_atomic(uuid,text,uuid,jsonb)` avait pour corps un md5
  `ee6120680d75633db519d5888d6eae8b` (4 763 caractères). C'est le corps de sa dernière définition dans le dépôt,
  [20261112025548_takeoff_page_decisions.sql](../../supabase/migrations/20261112025548_takeoff_page_decisions.sql). Aucun
  correctif appliqué hors migration n'a donc été écrasé.
- Le code servi en production, `6f87d328`, appelle cette surcharge avec la même signature et le même type de retour. Le
  refus qu'elle oppose, `TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED`, existait déjà. La migration ne change aucun code
  applicatif.

## Après l'application

- L'historique compte **405 lignes**. Les 404 lignes antérieures à `20261113234337` gardent le SHA-256
  `b950ea8466351a6fe062c758147fcea4d8b50844fcfcf1660bcf956629e6a437` : seule la ligne de cette migration s'y est
  ajoutée. L'empreinte est calculée en UTF-8 par
  `sha256(string_agg(version||name||array_to_string(statements,E'\n'), E'\n' order by version))`.
- La surcharge à 4 arguments a pour corps un md5 `d082d47e9b2b041003e9e99d60441bf1` (5 546 caractères), égal au corps
  du fichier.
- La surcharge à 4 arguments reste `SECURITY DEFINER`, avec `search_path=pg_catalog`. Ses droits n'ont pas changé :
  `EXECUTE` pour `postgres`, `authenticated` et `service_role`, rien pour `public` ni `anon`.
- Les deux surcharges sont toujours les seules : `(uuid,text,uuid,jsonb)` et `(uuid,text,uuid,jsonb,text)`. La seconde
  n'a pas été touchée.

## Advisor de sécurité

Avant et après, les mêmes constats, sans aucun ajout ni retrait : `rls_enabled_no_policy` (INFO, 26),
`authenticated_security_definer_function_executable` (WARN, 80) et `auth_leaked_password_protection` (WARN, 1). La
surcharge à 4 arguments y figurait déjà parmi les fonctions `SECURITY DEFINER` exécutables par `authenticated`. C'est
une RPC de l'application, qui vérifie elle-même le tenant actif et le rôle.

## Limites

Ce reçu ne prouve que l'application et l'état du schéma. Il ne prouve pas le comportement en production : la fenêtre de
concurrence que TI-728 ferme est prouvée par le test pgTAP `takeoff-apply-dpgf-check-race` de la PR, pas sur la base
partagée. Relevé à 23:45 UTC : la base partagée ne compte encore aucune autorisation d'application de métré, ni
aucune ligne de devis issue d'un métré.

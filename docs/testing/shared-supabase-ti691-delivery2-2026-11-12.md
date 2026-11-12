# TI-691 livraison 2 — reçu des migrations partagées (consultation)

Le 12 novembre 2026, les deux migrations de la consultation des fournisseurs ont été appliquées sur la base Supabase
partagée, qui sert aussi la production. Elles ont été appliquées dans l'ordre de leurs horodatages, après la fusion de
leur PR et avec le go explicite du propriétaire. Aucune donnée métier n'a été écrite pendant ces opérations et leurs
contrôles, et aucun déploiement n'a été fait.

Le [reçu TI-692](shared-supabase-ti692-2026-11-12.md) précède ce lot dans l'historique distant. Il couvre aussi
`20261112142534` et `20261112152357`, déjà appliquées.

## Source et méthode

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261112173255_material_request_quotes.sql](../../supabase/migrations/20261112173255_material_request_quotes.sql) | [#279](https://github.com/maxlemeur/HEX_BC/pull/279) (`b57b22d0`) | `20261112200257` | 64 635 | 1 |
| [20261112192815_material_request_quote_files_and_message.sql](../../supabase/migrations/20261112192815_material_request_quote_files_and_message.sql) | [#281](https://github.com/maxlemeur/HEX_BC/pull/281) (`e0914ac6`) | `20261112201757` | 2 644 | 1 |

SHA-256 de chaque fichier, identique à celle du SQL enregistré et à celle du manifeste :

- `20261112173255_material_request_quotes` :
  `dafe23748578cd3bf3cbba66a247d69761903f5ecb3a0612cf5c57e05a07680b`.
- `20261112192815_material_request_quote_files_and_message` :
  `3c50337edff1a9543ada538e859ee96bb8c645638522450a8fa89c02f201678b`.

Chaque fichier a été appliqué par un seul appel MCP `apply_migration`, nommé d'après son nom de fichier sans
extension, avec son contenu exact (UTF-8, fins de ligne LF, dernière fin de ligne incluse). Les versions distantes
correspondent aux heures d'application. Aucun `db push`, aucune autre migration et aucun SQL correctif n'ont été
exécutés. Les contrôles `execute_sql` étaient en lecture seule.

## Préflight et intégrité de l'historique

Avant chaque application, la migration était absente de l'historique, les objets requis présents et les objets
nouveaux absents. Les deux fonctions privées que la première migration remplace avaient le `md5(prosrc)` de leur
dernière définition dans les migrations :

- `private.enforce_material_request_line_write()` : `8ca88b0c575509a5c6d2274bf5f267c4`, celle de
  `20261112152357` ;
- `private.enforce_material_request_file_write()` : `f41207868851fb88583cc6ec550ca080`, celle de
  `20261112014046`, dont le SQL enregistré est identique au fichier.

Avant la seconde migration, `withdraw_material_request_files_for_deletion` avait le corps de la première
(`db2cf7ff7efe2106aa94faf124bff1f5`), sans dépendance. Aucun correctif divergent n'a été écrasé.

| Étape | Lignes avant → après | SHA-256 avant, identique aux autres lignes après |
| --- | --- | --- |
| 1 | 391 → 392 | `08ae8594486ac6e04b739d3f4dfc1c0fee8b0aeb84d62e02964f8fedba5eb15e` |
| 2 | 392 → 393 | `d4bb9e02a7bab19c1f5f5fa3a87b760973fc840dd238aca5fff3ef1aca364194` |

L'empreinte est calculée en UTF-8 par
`sha256(string_agg(version||name||array_to_string(statements,E'\n'), E'\n' order by version))`.
L'historique final compte **393 lignes**, SHA-256
`6b6c97950c3b009b5b84499eb760c8f64c47d8976ebac9cb87582d8de0087d79`. L'empreinte de départ est celle que le reçu
TI-692 donne pour son historique final.

## Compatibilité avec la production déployée

La production sert `1d44b253`, antérieur à la consultation. Ce code n'écrit aucun prix de ligne et aucun fichier de
devis, et il ne lit pas les nouvelles tables. Il retire les originaux d'une demande par une mise à jour directe de
`removed_at`, qu'aucune des deux migrations ne change pour un fichier sans devis. Il n'appelle pas
`withdraw_material_request_files_for_deletion`, dont la seconde migration change le type de retour.

Le code de `main` attend ce nouveau type (`text[]`) : ces deux migrations précèdent tout déploiement de la
consultation.

## Contrôles sur la base partagée

- **Devis** : les tables `material_request_quotes` et `material_request_quote_lines` existent, avec RLS et FORCE RLS
  et six politiques. `create_`, `update_` et `retain_material_request_quote` ainsi que
  `withdraw_material_request_files_for_deletion` sont SECURITY INVOKER, exécutables par `authenticated`, pas par
  `anon` ni PUBLIC.
- **Fonctions privées** : les quatre fonctions de déclencheur créées sont SECURITY INVOKER, sans EXECUTE pour
  `authenticated`.
- **Fonctions remplacées** : les deux fonctions de déclencheur remplacées correspondent au fichier
  (`c4248f17758909cca2e383ecfba4a3e9` pour les lignes, `57597c75af1f0b8e0e58caac1d9eb920` pour les fichiers).
- **Lignes et fichiers** : les trois colonnes de prix des lignes et la colonne `quote_id` des fichiers sont présentes.
  Le bucket `material-requests` accepte en plus `application/pdf`.
- **Seconde migration** :
  - le CHECK du message borne à 1 à 262 144 caractères ;
  - `withdraw_material_request_files_for_deletion` retourne `text[]`, reste SECURITY INVOKER avec
    `search_path=""`, est exécutable par `authenticated` seulement et porte son nouveau commentaire ;
  - son corps correspond au fichier (`989a2a5ba06af0e9753b2497fd23c330`).

**Réserve ACL :** les deux nouvelles tables reçoivent de `service_role` les privilèges REFERENCES, TRIGGER et
TRUNCATE, par les privilèges par défaut du schéma `public`. Aucun SQL hors périmètre n'a été ajouté pour les retirer.

## Avis de sécurité

`get_advisors security` a été exécuté avant la première application et après chacune des deux.

| Avis | Avant | Après |
| --- | ---: | ---: |
| [RLS active sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 24 INFO | 24 INFO |
| [SECURITY DEFINER accessible à authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 75 WARN | 75 WARN |
| [Protection des mots de passe divulgués désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 WARN | 1 WARN |

Ces deux migrations ne créent aucune fonction SECURITY DEFINER ni aucune table sans politique. Les avis préexistants
restent ouverts.

## Limites et reprise

Les contrôles prouvent le SQL appliqué, l'historique, le catalogue, les droits et les avis. Ils ne qualifient aucun
parcours métier en production : la consultation n'y est pas déployée. Sa qualification est celle des PR #279 et #281
(pgTAP, matrice RLS, parcours MR01 à MR05 sur des piles locales possédées).

Cette PR est documentaire : cohérence, liens et `git diff --check` seulement. Son annulation n'annule pas les
migrations. Privilégier une correction compatible en avant ; toute intervention distante supplémentaire nécessite sa
propre autorisation.

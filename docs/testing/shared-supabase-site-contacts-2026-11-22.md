# Contacts sur site de l'affaire sur la base partagée : reçu du 22 novembre 2026

Le 22 novembre 2026 à 20:46:18 UTC (21:46 à Paris), la migration de TI-691 « contacts sur site de l'affaire » a été
appliquée sur la base Supabase partagée, qui sert aussi la production. Elle l'a été après la fusion de sa PR, sous le go
permanent du propriétaire pour les migrations partagées ([AGENTS.md](../../AGENTS.md), 22 novembre 2026) : elle
n'active rien, ne retire aucune donnée et n'élargit l'accès à aucune donnée existante. Aucune donnée métier n'a été
écrite par l'application ou par ses contrôles, et aucun déploiement n'a été fait.

## Source et méthode

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261122194343_affaire_site_contacts.sql](../../supabase/migrations/20261122194343_affaire_site_contacts.sql) | [#493](https://github.com/maxlemeur/HEX_BC/pull/493) (`6e5c3d4d`) | `20261122204618` | 20 059 | 1 |

Trois SHA-256 sont égaux, `fa1330fd7cb18f87081280c95e6c687e57220f70a85ec2b3410def91ff172adc` :
- celui du fichier sur `origin/main` ;
- celui du [manifeste](../../supabase/migrations.manifest.json) ;
- celui du SQL enregistré, `sha256(statements[1])`.

Le fichier a été appliqué par un seul appel MCP `apply_migration`, sous le nom du fichier sans son extension et avec son
contenu exact : UTF-8, fins de ligne LF, dernière fin de ligne incluse, sans tabulation ni barre oblique inverse. La
version distante correspond à l'heure d'application. Aucun `db push` ni aucun SQL correctif n'a été exécuté, et les
contrôles `execute_sql` étaient en lecture seule.

## Avant l'application

- L'historique comptait **432 lignes**, de SHA-256 `61b705857d352d790fe200ab2f14fb2ed1fec8755b1a19ce7b01e70bf0c4cbf4`
  (`sha256(string_agg(version||name||array_to_string(statements,E'\n'), E'\n' order by version))`, en UTF-8). La plus
  récente était `20261122175145_material_request_quote_shipping_discount` (version `20261122193603`).
- La colonne `estimate_projects.site_contacts` et les fonctions `private.normalize_affaire_site_contacts` et
  `private.affaire_site_contacts_text` n'existaient pas.
- `public.create_material_request_purchase_orders`, que la migration remplace, avait le corps de sa dernière définition
  dans le dépôt, 20261122175145 (md5 de `prosrc` `68107786e27bb668114f34911cb28b1b`) : aucun correctif appliqué hors
  migration n'a donc été écrasé.
- `20261122193622_takeoff_item_acceptance_marks_revision` ([#485](https://github.com/maxlemeur/HEX_BC/pull/485)),
  fusionnée juste avant, n'était pas appliquée. Cette migration n'en dépend pas et ne l'a pas appliquée : elle reste à
  appliquer par la session qui la porte.

## Après l'application

- L'historique compte **433 lignes**. Les 432 autres lignes gardent le SHA-256
  `61b705857d352d790fe200ab2f14fb2ed1fec8755b1a19ce7b01e70bf0c4cbf4` : seule la ligne de cette migration s'y est ajoutée.
- `estimate_projects.site_contacts` est `jsonb not null default '[]'::jsonb`, avec la contrainte
  `estimate_projects_site_contacts_shape_check` et le déclencheur `normalize_affaire_site_contacts`. Aucune affaire n'a
  encore de contact (toutes valent `[]`).
- Les deux fonctions privées fixent `search_path=""` et ne sont pas exécutables par `authenticated`.
- `create_material_request_purchase_orders` a le corps du fichier (md5 `aedaaa6b5406045954f9529de0369979`) et garde ses
  droits : `EXECUTE` pour `authenticated`, rien pour `anon`.

## Advisor de sécurité

Comparés constat par constat, avant et après, sans aucun ajout ni retrait : `rls_enabled_no_policy` (INFO, 31),
`authenticated_security_definer_function_executable` (WARN, 102) et `auth_leaked_password_protection` (WARN, 1).

## Effet sur la version servie

La version servie ne lit ni n'écrit la colonne. Dès l'application, un brouillon créé depuis une demande de matériel n'a
plus « Demande de matériel du … (technicien) » dans ses instructions, puisqu'aucune affaire n'a encore de contact :
c'est la suppression demandée par le propriétaire. La date de la demande reste sur chaque ligne du bon, et les
instructions d'un brouillon restent modifiables. Les contacts s'impriment une fois le nouveau code déployé et
renseigné sur la fiche de l'affaire.

## Limites

Ce reçu ne prouve que l'application et l'état du schéma. Le comportement est prouvé par le test pgTAP
[affaire-site-contacts](../../supabase/tests/database/affaire-site-contacts.test.sql) et le parcours TesterArmy MR06
de la PR, pas sur la base partagée.

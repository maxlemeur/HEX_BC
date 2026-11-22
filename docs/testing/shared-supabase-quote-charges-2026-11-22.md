# Port et remise du devis fournisseur sur la base partagée : reçu du 22 novembre 2026

Le 22 novembre 2026 à 19:36:03 UTC (20:36 à Paris), la migration de TI-691 « port et remise du devis » a été appliquée
sur la base Supabase partagée, qui sert aussi la production. Elle l'a été après la fusion de sa PR, sous le go permanent
du propriétaire pour les migrations partagées ([AGENTS.md](../../AGENTS.md), 22 novembre 2026) : elle n'active rien, ne
retire rien et n'élargit l'accès à aucune donnée existante. Aucune donnée métier n'a été écrite par l'application ou par
ses contrôles, et aucun déploiement n'a été fait.

## Source et méthode

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261122175145_material_request_quote_shipping_discount.sql](../../supabase/migrations/20261122175145_material_request_quote_shipping_discount.sql) | [#490](https://github.com/maxlemeur/HEX_BC/pull/490) (`026144bd`) | `20261122193603` | 41 344 | 1 |

Trois SHA-256 sont égaux, `0bce0cf312aea672694e638968ac66b4c599030751bea896208bfd172f9ee779` :
- celui du fichier sur `origin/main` ;
- celui du [manifeste](../../supabase/migrations.manifest.json) ;
- celui du SQL enregistré, `sha256(statements[1])`.

Le fichier a été appliqué par un seul appel MCP `apply_migration`, sous le nom du fichier sans son extension et avec son
contenu exact : UTF-8, fins de ligne LF, dernière fin de ligne incluse, sans tabulation ni barre oblique inverse ; les
seuls caractères non ASCII sont des guillemets « », des lettres accentuées et le signe €. La version distante correspond
à l'heure d'application. Aucun `db push` ni aucun SQL correctif n'a été exécuté, et les contrôles `execute_sql` étaient
en lecture seule.

## Avant l'application

- Seule cette migration de `origin/main` manquait : la plus récente de l'historique était
  `20261122145415_takeoff_item_review_work_tables` (version `20261122171226`).
- L'historique comptait **431 lignes**, de SHA-256 `6efc42eb60329be3810bee4c5227268fc421edd2330ac4ea99dc3b2d9349967c`
  (`sha256(string_agg(version||name||array_to_string(statements,E'\n'), E'\n' order by version))`, en UTF-8).
- Les colonnes `material_request_quotes.shipping_ht_cents`, `discount_ht_cents` et
  `purchase_order_items.material_request_quote_id`, la table `private.material_request_quote_charge_orders` et les quatre
  fonctions de déclencheur nouvelles n'existaient pas.
- Les quatre fonctions que la migration remplace avaient le corps de leur dernière définition dans le dépôt (md5 de
  `prosrc`) : aucun correctif appliqué hors migration n'a donc été écrasé.

| Fonction | Dernière définition | md5 du corps |
| --- | --- | --- |
| `public.update_material_request_quote` | 20261112173255 | `928e50a711c69468cad845dcc39e4c5f` |
| `public.create_material_request_purchase_orders` | 20261113190113 | `d8bc8718d2a048304564c7b89f636e25` |
| `private.material_request_order_lines` | 20261112202147 | `d90b017e780d243803ed4a9dec47cacb` |
| `public.material_request_order_summary` | 20261112202147 | `ae43ab8ff4da58403d42bc25e9281348` |

## Après l'application

- L'historique compte **432 lignes**. Les 431 autres lignes gardent le SHA-256
  `6efc42eb60329be3810bee4c5227268fc421edd2330ac4ea99dc3b2d9349967c` : seule la ligne de cette migration s'y est ajoutée.
- Les trois colonnes existent. `private.material_request_quote_charge_orders` a la RLS active et aucun droit pour
  `anon`, `authenticated` ni `service_role`.
- Les cinq déclencheurs sont en place : `guard_material_request_quote_charges`, `guard_purchase_order_item_quote_charge`,
  `guard_purchase_order_item_quote_charge_change`, `track_material_request_quote_charge_order` et
  `track_material_request_quote_charge_order_status`.
- Les quatre fonctions privées nouvelles fixent `search_path=""` et ne sont pas exécutables par `authenticated`.
- `update_material_request_quote`, `create_material_request_purchase_orders` et `material_request_order_summary`
  gardent leurs droits : `EXECUTE` pour `authenticated`, rien pour `anon`.

## Advisor de sécurité

Comparés constat par constat, avant et après :
- `rls_enabled_no_policy` (INFO) passe de 30 à 31. Le seul ajout est `private.material_request_quote_charge_orders` :
  un registre privé lu et écrit par des fonctions `SECURITY DEFINER` seulement, comme son voisin
  `private.material_request_line_orders` ;
- `authenticated_security_definer_function_executable` (WARN, 102) et `auth_leaked_password_protection` (WARN, 1) sont
  inchangés.

## Compatibilité avec la version servie

Les colonnes ajoutées sont facultatives. Le résumé des commandes d'une demande ne porte la clé nouvelle
`waiting_quote_line_ids` que lorsqu'une ligne attend les autres lignes de son devis remisé. Or aucun devis n'a encore de
remise, puisque la colonne vient d'être créée. La version servie lit donc la même réponse qu'avant, et le nouveau code
attend un déploiement autorisé séparément.

## Limites

Ce reçu ne prouve que l'application et l'état du schéma. Le comportement est prouvé par le test pgTAP
[material-request-quote-charges](../../supabase/tests/database/material-request-quote-charges.test.sql) et les parcours
TesterArmy MR01 à MR11 de la PR, pas sur la base partagée.

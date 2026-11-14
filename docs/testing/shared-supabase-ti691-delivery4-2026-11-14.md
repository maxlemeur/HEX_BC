# TI-691 livraison 4 — reçu de la migration partagée (coût des fournitures par affaire)

La migration du coût des fournitures par affaire est dans l'historique de la base Supabase partagée, qui sert aussi la
production. Elle y a été appliquée le 13 novembre 2026 à 23:21:05 UTC, après la fusion de sa PR, par une intervention
distincte de ce reçu. Le [reçu TI-728](shared-supabase-ti728-2026-11-14.md) la cite déjà parmi les prérequis de sa
migration. Ce reçu en vérifie l'identité et l'effet le 14 novembre 2026, en lecture seule : aucune donnée, aucun objet
et aucune ligne d'historique n'ont été écrits pour l'établir.

## Source et identité

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261113220931_affaire_supply_cost.sql](../../supabase/migrations/20261113220931_affaire_supply_cost.sql) | [#328](https://github.com/maxlemeur/HEX_BC/pull/328) (`82f4ef15`) | `20261113232105` | 9 685 | 1 |

La ligne d'historique porte le nom du fichier sans extension. Trois SHA-256 sont égaux : celui du fichier sur `main`,
celui du [manifeste](../../supabase/migrations.manifest.json) et celui du SQL enregistré
(`sha256(array_to_string(statements, E'\n'))`). Ce SHA-256 est
`4c625f572e03f2d477adc51667bc6721ed3b782fae94e79da5e79446a9f7a163`.

Elle suit dans l'historique `20261113211347_takeoff_dpgf_section_replace` (TI-726, version `20261113232033`), qu'elle
ne lit pas.

## Effet sur le catalogue

`public.affaire_supply_cost(uuid)` existe avec la définition du fichier :

- **Corps :** `md5(prosrc)` `8c573ab6b348abce7f27fc194bcade48`, 6 203 caractères, égal au texte entre les délimiteurs
  `$$` du fichier.
- **Exécution :** SECURITY DEFINER, `stable`, `search_path` vide.
- **Droits :** exécutable par `authenticated`, ni par `anon` ni par PUBLIC.
- **Commentaire :** celui du fichier (« TI-691 delivery 4: … »).

La fonction ne lit que des tables du tenant actif et n'écrit rien. Aucune donnée n'a été réécrite par la migration.

## Advisor de sécurité

L'advisor du 14 novembre 2026 ne montre aucune catégorie nouvelle. La fonction rejoint
`authenticated_security_definer_function_executable` (WARN, 80 fonctions au lieu de 79). C'est le modèle voulu : elle
vérifie elle-même que l'appelant lit l'affaire, avec `public.can_read_affaire_intake_project` (propriétaire,
administrateur ou directeur du tenant actif), et ne trouve pas une affaire archivée. Les autres catégories sont
inchangées : `rls_enabled_no_policy` (INFO, 26) et `auth_leaked_password_protection` (WARN, 1).

## Qualification et limites

La qualification de la fonction est celle de la PR #328, sur des piles locales possédées : 92 fichiers pgTAP et
5 273 assertions vertes, dont les 44 de
[affaire-supply-cost.test.sql](../../supabase/tests/database/affaire-supply-cost.test.sql), la matrice RLS, le parcours
MR09 et `verify:pr`.

Ce reçu ne qualifie aucun parcours en production. Le dernier déploiement enregistré, `6f87d328`
([reçu du 13/11](shared-supabase-main-catchup-2026-11-13.md)), ne contient pas le code qui appelle la fonction.
L'application de la migration précède donc ce code, comme le prévoit la livraison. Son déploiement relève de son propre
reçu.

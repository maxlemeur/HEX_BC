# Règles fixes du métré sur le Supabase partagé — 05/11/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md#appliquer-sur-une-base-partagée).

**Trois migrations appliquées et vérifiées : résultats de règles par ligne de métré, garde SQL au même compte que le garde TS, recalcul et invalidation des lignes voisines, bornes et sérialisation des écritures, exclusions prévues dans les règles croisées. Aucune donnée n'est écrite. Aucun déploiement dans ce reçu ; les règles restent derrière `MERGEONE_TAKEOFF_RULES`, désactivé.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Sources :
- `main` à `53fd4937` pour les deux premières migrations : [PR #160](https://github.com/maxlemeur/HEX_BC/pull/160) (TI-664 L5b) et [PR #166](https://github.com/maxlemeur/HEX_BC/pull/166) (TI-677) ;
- `main` à `cd474ca4` pour la troisième : [PR #170](https://github.com/maxlemeur/HEX_BC/pull/170) (TI-677).

Application : via l'outil MCP `apply_migration`, avec le SQL de chaque fichier ; chaque appel a été confirmé par le porteur. L'autorisation vient du porteur (5/11) : « Je te donne le feu vert pour les migrations tu es autonome maintenant dessus », pour les migrations fusionnées de la famille TI-658.

| Migration canonique | Taille | SHA-256 du fichier (= manifeste) | Version distante | Appliquée (UTC) |
|---|---|---|---|---|
| `20261103213336_takeoff_quantity_rules.sql` | 26 594 octets (653 lignes) | `e844be8807f6793b979ce81c5ec11d13f2e555ae51ad063e7558bd926b9940b6` | **`20261105013210`** | 05/11 01:32:10 |
| `20261104215000_takeoff_rule_bounds_and_serialization.sql` | 25 888 octets (681 lignes) | `a89759842f36ed5b8ca43a413c2077ab285ff621513588b15c03722cef2d9d53` | **`20261105013334`** | 05/11 01:33:34 |
| `20261104224500_takeoff_rule_cross_exclusions.sql` | 4 818 octets (113 lignes) | `1fbf6321dfdbc28f83534ecfe85c5f04ff91b891e170e29b68c5aaf533289554` | **`20261105021448`** | 05/11 02:14:48 |

Noms distants : `20261103213336_takeoff_quantity_rules`, `20261104215000_takeoff_rule_bounds_and_serialization`, `20261104224500_takeoff_rule_cross_exclusions`.

## Instructions enregistrées

- `20261103213336_takeoff_quantity_rules` : une instruction de 26 593 octets, SHA-256 `26b740c053cdd1f5b8c8f78e37afa627c7de83beeb3c43b812c0443fded80c7d`. **Identique au fichier** sans son saut de ligne final.
- `20261104224500_takeoff_rule_cross_exclusions` : une instruction de 4 817 octets, SHA-256 `453b83db9735d8b65cc58ce9984c282dc46626113bcb1ec4bdd76299ae0d1c7e`. **Identique au fichier** sans son saut de ligne final.
- `20261104215000_takeoff_rule_bounds_and_serialization` : une instruction de 25 815 octets, SHA-256 `d67e66e1d7efb93e54dd70d666c1e37f8bfeadb40e890e01a05c4af55e169447`. **Différente du fichier** (25 887 octets sans le saut de ligne final, SHA-256 `bbf8b1d600ec5a3089d2e1c75ecad018ab6f73398f9d470ae9dafdd4fcf4bcc4`), voir l'écart ci-dessous.

### Écart sur `20261104215000`

- **Où :** uniquement à la ligne 41, dans `public.takeoff_low_confidence_threshold(text)`, dans la classe de caractères qui reproduit le `trim()` de JavaScript.
- **Quoi :** le transport MCP a décodé les onze séquences ` `, ` `, ` `, ` `, ` `, ` `, ` `, ` `, ` `, `　` et `﻿` du texte SQL, dans les deux copies de la classe. Elles sont enregistrées comme les caractères qu'elles désignent ; `\u0009` et `\u000d` sont restés échappés. Ces 72 octets font tout l'écart.
- **Preuve :** l'instruction enregistrée, reconstruite en SQL avec la ligne 41 littérale du fichier (la barre oblique écrite par `chr(92)`), fait 25 887 octets et a le SHA-256 du fichier sans son saut de ligne final.
- **Même comportement :** la classe déployée contient les mêmes points de code et plages que celle du fichier. En lecture seule, `0.7` entouré de l'un des 17 blancs du `trim()` de JavaScript donne 0,7 ; précédé de NEL, U+180E, U+200B à U+200D, U+2060, U+2030 ou d'une lettre, il donne 0,5. `0x1`, `7e-0001` et `null` donnent 0,5, `0.12341` donne 0,1235.
- **Conséquence :** `pg_get_functiondef` de cette fonction diffère textuellement de celui d'une stack locale, pas son résultat. Elle n'est pas réécrite : ce serait un nouveau DDL sans effet. Pour la suite, une migration qui passe par `apply_migration` évite les séquences `\uXXXX` dans son texte SQL (préférer `chr(n)`).

## Avant

- **Historique distant :** 352 lignes ; la dernière était `20261103153311_takeoff_vector_geometry` (version `20261103194236`).
- **Écart avec `main` :** seules ces migrations manquaient, et ce sont les plus récentes. L'ordre est respecté.
- **Objets :** les colonnes et fonctions nouvelles étaient absentes ; les prérequis (`public.profiles`, `public.takeoff_items`, `public.takeoff_jobs`, `public.takeoff_vector_pages`) étaient présents.
- **Données :** `takeoff_items`, `takeoff_jobs` et `takeoff_vector_pages` sont vides sur le partagé (0 ligne, compté en `postgres`, qui contourne la RLS). Aucune ligne ne pouvait donc être bloquée ou modifiée par ces migrations.
- **Validation préalable,** sur des stacks locales possédées, avant chaque fusion : `npm run db:ci:local` et `npm run supabase:types` (pgTAP complet, matrice RLS), parcours TKR01/TKR02, `npm run verify:pr` sur la tête exacte.

## Vérifications après application

- **Historique :** 355 lignes, une seule par nouveau nom, les trois en dernières positions.
- **Colonnes de `takeoff_items` :** `rule_results` jsonb non null (défaut `'[]'::jsonb`), `rules_stale` booléen non null (défaut `false`), `rules_evaluated_at`, `rules_stale_at` et `quantity_entered_at` nullables, `quantity_entered_by` nullable avec sa clé étrangère validée, et l'index `takeoff_items_quantity_entered_by_idx`. `takeoff_vector_pages.rule_anchors` est présente, avec ses contraintes validées.
- **Fonctions et droits :**
  - `takeoff_item_rule_blocked`, `takeoff_low_confidence_threshold`, `takeoff_rule_version_stamp`, `write_takeoff_rule_results` et `takeoff_rule_failure_left_out` : `security invoker`, exécutables par `service_role` seulement ;
  - `stale_takeoff_rule_peers` et `stale_takeoff_rule_lines_on_completion` : `security definer`, EXECUTE retiré à `public`, `anon` et `authenticated` ;
  - `update_takeoff_item_for_review` et les deux surcharges de `apply_takeoff_job_guarded_atomic` : exécutables par `authenticated`, comme leurs `grant` le prévoient ;
  - `enforce_takeoff_apply_security` et `enforce_authenticated_takeoff_item_fields` sont remplacées (md5 `c376e320` → `4dfdd3ab` et `116a7079` → `e1e1d33d`).
- **Triggers :** `stale_takeoff_rule_peers_after_insert` et `stale_takeoff_rule_peers_after_update` sur `takeoff_items` (par instruction, avec tables de transition), `stale_takeoff_rule_lines_on_completion` sur `takeoff_jobs`, et `set_takeoff_items_updated_at` recréé avec sa clause `WHEN`.
- **RLS :** active et forcée sur `takeoff_items`, `takeoff_jobs` et `takeoff_vector_pages`.
- **Écritures par `authenticated` :** le droit `UPDATE` hérité sur la table couvre les nouvelles colonnes, mais le trigger `aac_enforce_authenticated_takeoff_item_fields` les refuse : les colonnes `rules_*` sont hors de sa liste blanche, et `quantity_entered_*` doit être attesté.
- **Advisors de sécurité** (01:33 et 02:15 UTC) : aucun nouveau constat. Les constats existants sont inchangés : 24 INFO « RLS sans politique » sur les tables réservées au serveur, 70 fonctions SECURITY DEFINER exécutables par `authenticated` (les nouvelles fonctions definer n'en font pas partie), la protection contre les mots de passe divulgués, désactivée.

## Limites

Aucune donnée n'est écrite et aucun déploiement n'est fait. Les résultats de règles ne s'écrivent que si le worker tourne avec `MERGEONE_TAKEOFF_RULES=1`, qui reste désactivé. Avant de l'activer, les prérequis restants de TI-677 doivent être fusionnés et leurs migrations appliquées.

[Rapport JSON](./shared-supabase-takeoff-rules-2026-11-05.json).

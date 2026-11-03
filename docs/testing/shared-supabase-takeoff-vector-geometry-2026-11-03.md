# Géométrie vectorielle du métré sur le Supabase partagé — 03/11/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md#appliquer-sur-une-base-partagée).

**Migration appliquée et vérifiée : deux tables `public.takeoff_vector_pages` et `public.takeoff_item_geometries`, sous RLS forcée, lisibles par `authenticated` à travers l'accès au job, écrites par le service role seulement. Aucune donnée n'est écrite. Aucun déploiement dans ce reçu ; la lecture vectorielle reste derrière `MERGEONE_TAKEOFF_VECTORS`, désactivé.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `6507c12` (fusion de la [PR #147](https://github.com/maxlemeur/HEX_BC/pull/147), TI-662 L3b).

Application : via l'outil MCP `apply_migration`, avec le SQL exact du fichier. L'autorisation vient du porteur (3/11), donnée pour cette migration de TI-662, à appliquer après sa validation sur une stack locale et sa fusion.

| Identité | Valeur |
|---|---|
| Migration canonique | `20261103153311_takeoff_vector_geometry.sql` |
| Taille | **6 458 octets** (127 lignes) |
| SHA-256 du fichier (= manifeste) | `1897ff9600aae452718af1ce91a407156e8cbe89ae7bc28ec0e82acb8a495947` |
| SHA-256 de l'instruction enregistrée | `2754026b4c4d87b4089c82538b59c51df9026c997a30ed173ca2cd99202d6a6d` : le fichier sans son saut de ligne final (6 457 octets) |
| Version distante | **`20261103194236`** |
| Nom distant | `20261103153311_takeoff_vector_geometry` |
| Application | 03/11/2026 à 19:42:36 UTC |

## Avant

- **Historique distant :** la dernière ligne était `20261029224500_estimate_v3_freeze_revision_effects` (version `20261030021046`).
- **Écart avec `main` :** une seule migration de `main` manquait, celle-ci, qui est aussi la plus récente. L'ordre est donc respecté.
- **Objets :** aucun des deux n'existait. Les prérequis existaient : `public.current_tenant_id()`, `public.can_access_takeoff_estimate_version(uuid, uuid)`, `public.takeoff_results` et `public.takeoff_items`.
- **Contenu :** la migration est purement additive. Elle crée deux tables, leurs index, deux fonctions de trigger et deux politiques SELECT. Elle ne supprime rien et ne modifie aucune donnée.
- **Validation préalable,** sur une stack locale possédée, avant la fusion :
  - `npm run db:ci:local` : pgTAP, dont `takeoff-vector-geometry.test.sql`, et matrice RLS ;
  - les parcours TKW01 à TKW09.

## Vérifications après application

- **Historique :** 352 lignes. Une seule porte ce nom, en dernière position. Elle n'a qu'une instruction enregistrée, de SHA-256 égal au fichier sans son saut de ligne final.
- **`public.takeoff_vector_pages` et `public.takeoff_item_geometries` :**
  - RLS active et forcée ;
  - une politique SELECT `to authenticated` chacune, limitée au tenant courant et à l'accès au job ;
  - 4 index et un trigger chacune.
- **Droits :**
  - `anon` : aucun droit ;
  - `authenticated` : SELECT seulement, ni INSERT, ni UPDATE, ni DELETE.
- **Fonctions de trigger :** `assign_takeoff_vector_page_tenant_id()` et `assign_takeoff_item_geometry_tenant_id()`. EXECUTE est retiré à `public`, `anon` et `authenticated`. Elles n'apparaissent pas dans les avertissements « SECURITY DEFINER exécutable ».
- **Advisors de sécurité** (19:42 UTC) : aucun constat ne concerne ces objets. Les constats existants sont inchangés :
  - les INFO « RLS sans politique » sur les tables réservées au serveur ;
  - les 70 fonctions SECURITY DEFINER exécutables par `authenticated` ;
  - la protection contre les mots de passe divulgués, désactivée.

## Limites

Aucune donnée réelle n'est écrite et aucun déploiement n'est fait. Ces tables ne se remplissent que si le worker tourne avec `MERGEONE_TAKEOFF_VECTORS=1`, au niveau C.

[Rapport JSON](./shared-supabase-takeoff-vector-geometry-2026-11-03.json).

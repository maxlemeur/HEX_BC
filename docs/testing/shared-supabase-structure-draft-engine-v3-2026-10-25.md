# Structure IA sur un brouillon v3 sur le Supabase partagé — 25/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).

**Migration appliquée et vérifiée : `public.apply_estimate_structure_draft` remplacée avec sa branche v3, toujours SECURITY INVOKER et avec les mêmes droits. Aucun déploiement dans ce reçu.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `3c9e861` (fusion de la [PR #114](https://github.com/maxlemeur/HEX_BC/pull/114), lot 3.2 entrée 2). Appliquée par Claude via l'outil MCP `apply_migration`, avec le SQL exact du fichier, sous l'autorisation permanente du porteur pour les migrations fusionnées. La PR #112, fusionnée juste avant, n'apporte pas de migration.

| Identité | Valeur |
|---|---|
| Migration canonique | `20261025163000_structure_draft_apply_engine_v3.sql` |
| Taille | **8 943 octets** (268 lignes) |
| SHA-256 (fichier = manifeste = instruction enregistrée) | `b285119e254ab5e9817dadfc664e54d39a8c915134522bbacbedabef5d59da9f` |
| Version distante | **`20261025181423`** |
| Nom distant | `20261025163000_structure_draft_apply_engine_v3` |
| Application | 25/10/2026 à 18:14:23 UTC |

## Avant

Historique de 332 lignes, la dernière étant `takeoff_apply_engine_v3` (version `20261025155612`, [reçu](./shared-supabase-takeoff-apply-engine-v3-2026-10-25.md)). `public.apply_estimate_structure_draft` : SECURITY INVOKER, `search_path=public`, VOLATILE, propriétaire `postgres`, ACL `{postgres=X,authenticated=X,service_role=X}`, corps de MD5 `0bee1f25f8aea24aa8c878f58c11b6e7`, sans commentaire. Prérequis du préflight présents.

## Vérifications après application

- Historique : 333 lignes, une seule pour ce nom, en dernière position ; une seule instruction enregistrée, de SHA-256 égal au fichier.
- `public.apply_estimate_structure_draft(uuid, uuid, uuid, jsonb, jsonb, jsonb, timestamptz)` : toujours SECURITY INVOKER, `search_path=public`, VOLATILE, propriétaire `postgres`. Le MD5 du corps est égal à la source : `ae9800d9678f167b4566b5cda95bb4b4`. Le corps contient la branche v3 (`miaouffrage.estimate_v3_writer` et `public.estimate_v3_complete_entry_for_writer`). Le commentaire est celui de la migration.
- Droits inchangés : ACL `{postgres=X,authenticated=X,service_role=X}` ; `anon` n'a pas EXECUTE.
- Comptes relus dans le catalogue après application : aucune fonction SECURITY DEFINER de `public` exécutable par `anon`, et 70 exécutables par `authenticated`, comme avant. La fonction remplacée reste SECURITY INVOKER, donc hors de ces constats. Aucune table, politique RLS ni droit ne change.

## Limites

Aucun appel de la fonction sur le partagé et aucun déploiement : la production est restée à `7255d1d` (déploiement du 25/10 à 14:06 UTC). Les preuves fonctionnelles restent celles de la PR #114 (`supabase/tests/database/estimate-structure-draft-engine-v3.test.sql`, parcours IO08). [Rapport JSON](./shared-supabase-structure-draft-engine-v3-2026-10-25.json).

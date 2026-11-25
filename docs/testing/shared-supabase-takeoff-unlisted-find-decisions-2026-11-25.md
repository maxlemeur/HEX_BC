# Décisions sur les ouvrages hors liste · 25 novembre 2026

La base partagée a enregistré la migration de la [PR #568](https://github.com/thannous/HEX_BC/pull/568) à 11:16:55 UTC. La nouvelle table `public.takeoff_find_decisions` contenait zéro décision après application.

| Identité | Valeur vérifiée |
| --- | --- |
| Commit sur `main` | `44239d82b86c4afbd813d1cb4f6ccdada9fca45b` |
| [Migration](../../supabase/migrations/20261125101310_takeoff_unlisted_find_decisions.sql) | `20261125101310_takeoff_unlisted_find_decisions` |
| Version distante | `20261125111655` |
| SQL enregistré | Un appel à `apply_migration`, un élément dans `statements`, 14 043 octets, saut de ligne final compris |
| SHA-256 du fichier et du SQL enregistré | `45909a39719146ddbbfbb298f82ca79f44984da70172ed782bebb6e0291af123` |

## Historique et données

| Relevé | Avant | Après |
| --- | ---: | ---: |
| Entrées dans l’historique des migrations | 450 | 451 |
| Projets (`estimate_projects`) | 20 | 20 |
| Postes de liste (`takeoff_list_items`) | 23 | 23 |
| Décisions (`takeoff_find_decisions`) | Table absente | 0 |

La dernière version avant application était `20261125030636`. Les 450 entrées antérieures ont conservé leur empreinte. La migration de la [PR #535](https://github.com/thannous/HEX_BC/pull/535) figurait sur `main` et était absente de l’historique partagé aux deux relevés.

## Catalogue et droits

- Les 20 colonnes comprennent la clé de désignation calculée et stockée. Le catalogue confirme la clé primaire, l’unicité de `item_id`, les sept contraintes `CHECK` et les deux clés étrangères composites avec suppression en cascade des décisions associées.
- Les trois index explicites sont valides et prêts, ainsi que les deux index de contrainte. Les déclencheurs `takeoff_find_decisions_writer` et `takeoff_find_rereading` sont activés.
- RLS est active. L’unique politique de lecture, `takeoff_find_decisions_read`, exige l’accès au périmètre du métré et vérifie l’accès par le projet, le fichier de plan ou la pièce du dossier. Sur la table, `authenticated` dispose de `SELECT` seul et `service_role` de `SELECT`, `INSERT`, `UPDATE` et `DELETE`. Aucun droit n’est accordé à `PUBLIC` ni à `anon`.
- Les sept signatures étaient absentes avant application. Leurs corps correspondent au fichier et chacune fixe un `search_path` vide. Le propriétaire seul peut exécuter les trois fonctions privées. Parmi les rôles d’API, seul `service_role` peut exécuter le normaliseur `takeoff_find_designation_key(text)` et les trois commandes `SECURITY DEFINER` d’écartement, d’annulation et d’ajout.

## Santé et nouveaux avis Supabase

Le point de santé a répondu HTTP 200 avant et après application, en version 0.9.0, avec la base disponible. [Santé de production](https://hex-bc.vercel.app/api/health)

L’advisor de sécurité ne signale aucun nouveau constat. L’advisor de performance signale les deux clés étrangères composites sans index couvrant et les index `takeoff_find_decisions_rereading` et `takeoff_find_decisions_project` encore inutilisés lors du contrôle. [Clés étrangères](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) · [Index inutilisés](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

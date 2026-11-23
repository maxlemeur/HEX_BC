# Correction de la preuve des contributions ajoutées · 23 novembre 2026

La migration de [#524](https://github.com/maxlemeur/HEX_BC/pull/524) a été appliquée à **19:27:35 UTC**. La fonction privée conserve désormais `marks_revision` sur les seules parts issues d’un comptage vérifié. Le SQL enregistré sous la version `20261123192735` correspond aux **9 197 octets** du [fichier source](../../supabase/migrations/20261123185755_takeoff_revision_added_part_marks_revision.sql), saut de ligne final compris.

| Commit source | SHA-256 du fichier et du SQL enregistré |
| --- | --- |
| `d2624b3408b9d7aaa7e4b29bcd18d7cdd4f01883` | `2ff4dba4bfbbb88ee21cd05c7429a3b8d9f93aae915595ed1c297ea4106cc9b8` |

À 19:27:30 UTC, la base comptait zéro analyse en attente ou en traitement et zéro demande de lancement ouverte. L’historique passe de 444 à 445 migrations. L’empreinte des 444 entrées antérieures est identique après l’application.

| Fonction | MD5 avant, conforme à #522 | MD5 après, conforme à #524 |
| --- | --- | --- |
| `private.takeoff_revision_items(uuid, uuid, uuid, uuid, uuid)` | `2c91c8761d7e976cc0edf4eee14cf365` | `c75bc7a8d70e9adde8e28aac790b8848` |

Le catalogue contient une seule signature avant et après. La fonction appartient à `postgres`, s’exécute en mode `SECURITY INVOKER` et reste exécutable uniquement par son propriétaire. Les quatre [lignes d’activation](shared-supabase-takeoff-activation-2026-11-23.md) conservent leurs dates et leurs paramètres. Avant et après l’application, `/api/health` a répondu HTTP 200 en version 0.9.0, base disponible. La comparaison des constats de sécurité, de performance et de santé de l’advisor ne relève aucun ajout ni retrait. [Résultats détaillés](shared-supabase-takeoff-revision-added-part-2026-11-23.json)

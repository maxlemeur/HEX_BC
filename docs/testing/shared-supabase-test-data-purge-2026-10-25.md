# Purge hebdomadaire des données de test sur le Supabase partagé — 25/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md#données-de-test).

**Migration appliquée et vérifiée : listes privées des tenants de test et des affaires conservées, `public.purge_test_tenant_drafts` réservée au service role. Un passage à blanc liste 20 affaires ; rien n'a été supprimé. Aucun déploiement dans ce reçu.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `3ef4765` (fusion de la [PR #116](https://github.com/maxlemeur/HEX_BC/pull/116)). Appliquée via l'outil MCP `apply_migration` avec le SQL exact du fichier, sous l'autorisation permanente du porteur pour les migrations fusionnées ; le porteur a accepté la confirmation demandée par le connecteur.

| Identité | Valeur |
|---|---|
| Migration canonique | `20261025174800_test_tenant_draft_purge.sql` |
| Taille | **6 278 octets** (151 lignes) |
| SHA-256 (fichier = manifeste = instruction enregistrée) | `3d80b8b3bae4495acf295a9afa4c9047df21cc5a1e59a5fa6aaa8e84a055e408` |
| Version distante | **`20261025191547`** |
| Nom distant | `20261025174800_test_tenant_draft_purge` |
| Application | 25/10/2026 à 19:15:47 UTC |

## Avant

Contrôlé à 19:06:40 UTC. Historique de 333 lignes, la dernière étant `20261025163000_structure_draft_apply_engine_v3` (version `20261025181423`, [reçu](./shared-supabase-structure-draft-engine-v3-2026-10-25.md)). Aucun des objets de la migration n'existait. La base comptait 39 affaires.

Les trois tenants de la graine sont bien des tenants de test : chacun a un seul membre et aucune version hors brouillon.

| Tenant | Nom | Domaine du membre | Affaires |
|---|---|---|---|
| `a8d1292a-bfd1-4a44-9820-dc9536ecad25` | ARMY TesterArmy QA | `example.invalid` | 22 |
| `d6012a69-16ad-4cf8-866e-9a37e2f22cb6` | Espace personnel | `example.test` | 5 |
| `cba61ccf-d0d8-45d2-b298-d4f88117b120` | Espace personnel | `example.test` | 4 |

## Vérifications après application

- Historique : 334 lignes, une seule pour ce nom, en dernière position ; une seule instruction enregistrée, de SHA-256 égal au fichier.
- `private.test_data_tenants` : RLS active, aucune politique, ACL `{postgres=arwdDxtm/postgres}`, aucun droit pour `anon`, `authenticated` ni `service_role`. Trois lignes, les tenants ci-dessus, rétention de 7 jours.
- `private.test_data_retained_projects` : mêmes droits, vide.
- `public.purge_test_tenant_drafts(boolean, integer)` : SECURITY DEFINER, `search_path=""`, VOLATILE, propriétaire `postgres`, ACL `{postgres=X,service_role=X}`. Ni `anon` ni `authenticated` n'ont EXECUTE. MD5 du corps égal à la source : `2fa6e8e12ba60cc7c2ad97e6408bf805`.
- `private.test_data_project_is_stale(uuid, integer)` : SECURITY INVOKER, STABLE, `search_path=""`, ACL `{postgres=X}`, exécutable par aucun rôle de l'API. MD5 du corps égal à la source : `7e72f9bb1a92cc9dfa7ec6f0ef82f093`.
- Comptes relus dans le catalogue : aucune fonction de `public` exécutable par `anon` ; 70 fonctions SECURITY DEFINER de `public` exécutables par `authenticated`, comme avant.
- Advisors de sécurité (19:27 UTC) : aucun nouvel avertissement. Les deux tables privées rejoignent la liste INFO « RLS sans politique », voulue pour des tables réservées au serveur. Les avertissements existants sont inchangés.

## Passage à blanc

`public.purge_test_tenant_drafts(true, 1000)` à 19:27:16 UTC : 20 affaires `eligible`, toutes du tenant ARMY. Rien n'est supprimé : la base compte toujours 39 affaires. Les affaires des deux Espaces personnels ont moins de 7 jours.

## Limites

Aucune purge réelle et aucun déploiement. La route `GET /api/internal/test-data/purge` et le workflow « Purge Test Data » demandent `main` déployé ; la planification du lundi reste inactive tant que la variable `TEST_DATA_PURGE_ENABLED` ne vaut pas `true`. [Rapport JSON](./shared-supabase-test-data-purge-2026-10-25.json).

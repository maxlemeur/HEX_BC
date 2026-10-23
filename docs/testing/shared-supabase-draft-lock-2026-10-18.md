# Application de la migration du verrou de brouillon au Supabase partagé — 18/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).


**Migration appliquée et vérifiée, sans donnée modifiée, sans politique de calcul ni déploiement.**

Projet : `ijropnynpwjbllievrip`. Source immuable : `main` à `a0eb4f2a`, fusion de la PR #54 (V3E03).

| Source exacte | Octets | SHA-256 (= manifeste) | Version distante | Méthode |
|---|---|---|---|---|
| `20261018093005_serialize_estimate_draft_lock_acquisition.sql` | 2 598 | `66451e191aa8f317c83f2d87aacd39587fa6a6286b68ece431f7ae4352421178` | `20261018122210` | `apply_migration` (MCP `supabase_miaouffrage`), fichier exact avec son `begin;` … `commit;` |

Contenu : `create or replace` de la seule fonction de déclencheur `public.assign_draft_lock_tenant_id()`, qui prend
désormais, sur un `INSERT` de `draft_locks`, le verrou consultatif de la version
(`hashtextextended(version_id::text, 0)`, même clé que `public.takeover_estimate_draft_lock`). Aucun DML,
aucune table, aucun déclencheur créé ou supprimé. Cause et preuves : [v3e03-draft-lock-takeover.md](https://github.com/maxlemeur/HEX_BC/blob/9ee18ca8187d1e4f76e8b196be90d85e2fa1334b/docs/testing/v3e03-draft-lock-takeover.md).

Autorisation : délégation du porteur du 18/10/2026 (« décide pour moi pour le reste »), dans le prolongement de
l'autorisation d'appliquer les migrations du lot 2 après fusion de leur PR.

| Contrôle | Avant | Après |
|---|---|---|
| Corps de la fonction (MD5 sans CR) | `b4ddeb7d…29fe` (812 car.), égal à `20260802001942_estimate_lock_page_leases.sql` | `2c3d0d7f…d05e` (1 018 car.), égal au corps du fichier |
| `SECURITY DEFINER` / `search_path` | oui / `""` | inchangés |
| ACL | `{postgres=X/postgres,service_role=X/postgres}` | inchangée ; `EXECUTE` refusé à `anon` et `authenticated` |
| Déclencheur `set_draft_locks_tenant_id` sur `draft_locks` | actif (`O`) | actif (`O`) |
| `takeover_estimate_draft_lock` utilise `hashtextextended(` | oui | — |
| Lignes de `draft_locks` | 2 | 2 |
| Historique | dernière : `20261018093015` (M6b) | une ligne de plus : `20261018122210` |

Limites : aucun parcours n'est rejoué sur le partagé ; le comportement est prouvé sur des piles locales
(LOCK02, V3E03, CI de la PR #54). Conseillers Supabase non relus. Reste à appliquer : M5 (2.7) après la PR #45,
puis M8 (2.10).

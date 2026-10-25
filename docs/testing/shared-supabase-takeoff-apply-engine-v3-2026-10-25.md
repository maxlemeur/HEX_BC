# Application d'un métré à un brouillon v3 sur le Supabase partagé — 25/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).

**Migration présente et vérifiée : `private.takeoff_apply_v3_lines` créée sans aucun droit d'exécution hors propriétaire, `public.apply_takeoff_job_atomic` remplacée avec les mêmes droits (`service_role` seulement). Aucun déploiement dans ce reçu.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `c7ad760` (fusion de la [PR #110](https://github.com/maxlemeur/HEX_BC/pull/110), métré M2 v0.1). Appliquée par le porteur, sous son autorisation des migrations fusionnées, après deux essais de Claude restés sans effet (la confirmation demandée par le connecteur Supabase a expiré, à 15:01 et 15:40 UTC ; l'historique est resté à 331 lignes entre les deux).

| Identité | Valeur |
|---|---|
| Migration canonique | `20261025134000_takeoff_apply_engine_v3.sql` |
| Taille | **36 048 octets** (1 009 lignes) |
| SHA-256 (fichier = manifeste = instruction enregistrée) | `d4ff12ea3c6b30526aec54c0e7e24016005dc00bbb0903e699ff925bd9d7da18` |
| Version distante | **`20261025155612`** |
| Nom distant | `takeoff_apply_engine_v3` (sans horodatage, comme 227 autres lignes de l'historique) |
| Application | 25/10/2026 à 15:56:12 UTC |

## Avant

Relevé à 15:01 et 15:40 UTC : historique de 331 lignes, la dernière étant `20261025115010_tenant_calc_defaults_admin` (version `20261025135027`, [reçu](./shared-supabase-tenant-calc-defaults-2026-10-25.md)) ; `private.takeoff_apply_v3_lines` absente ; corps de `public.apply_takeoff_job_atomic` de MD5 `3c6f54bf650065cf1504f1e397787fd3`, ACL `{postgres=X,service_role=X}` ; prérequis du préflight présents.

## Vérifications après application

Relues en lecture seule le 25/10 à 16:21 UTC.

- Historique : 332 lignes, une seule pour ce nom, en dernière position ; une seule instruction enregistrée, de SHA-256 égal au fichier.
- MD5 des corps égal à la source :

| Fonction | Sécurité | `search_path` | ACL | MD5 du corps |
|---|---|---|---|---|
| `private.takeoff_apply_v3_lines(uuid, text, uuid)` | INVOKER | `""` | `{postgres=X}` | `79a6b4c917686c783990f232628fa431` |
| `public.apply_takeoff_job_atomic(uuid, text, uuid, jsonb)` | DEFINER | `pg_catalog` | `{postgres=X,service_role=X}` | `2f2182de717946f355b88c953cfd340b` |

- Droits : `anon` et `authenticated` n'exécutent aucune des deux ; `service_role` n'exécute que `apply_takeoff_job_atomic`, comme avant. Les deux sont VOLATILE, propriétaire `postgres`, et leur commentaire cite M2 v0.1.
- Conseillers de sécurité : inchangés depuis le [reçu de la #101](./shared-supabase-tenant-calc-defaults-2026-10-25.md) : aucune fonction SECURITY DEFINER exécutable par `anon`, 70 exécutables par `authenticated` (aucune des deux fonctions de cette migration n'en fait partie), 19 tables RLS sans politique, protection des mots de passe divulgués désactivée.

## Limites

Pas d'empreinte du catalogue avant/après : ce reçu décrit l'état constaté après une application faite hors de ce fil. Aucun appel des fonctions sur le partagé et aucun déploiement : la production est restée à `7255d1d` (déploiement du 25/10 à 14:06 UTC). Les preuves fonctionnelles restent celles de la PR #110. [Rapport JSON](./shared-supabase-takeoff-apply-engine-v3-2026-10-25.json).

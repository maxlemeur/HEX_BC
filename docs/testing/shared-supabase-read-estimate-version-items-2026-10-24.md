# Lecture des lignes par version sur le Supabase partagé — 24/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).

**Migration présente et vérifiée : une fonction ajoutée, exécutable par `authenticated` et `service_role` seulement. Aucune autre fonction, policy ou relation changée, aucun déploiement.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `922f1cf` (fusion de la [PR #100](https://github.com/maxlemeur/HEX_BC/pull/100)). Autorisation permanente du porteur du 24/10 pour appliquer au partagé les migrations fusionnées.

| Identité | Valeur |
|---|---|
| Migration canonique | `20261024130000_read_estimate_version_items.sql` |
| Taille | **3 805 octets** |
| SHA-256 (fichier = manifeste = instruction enregistrée) | `17ebd15328b232e6ddc1107664eb793926a6424925188f9ecfacddaa5018ba35` |
| Version distante | **`20261024151245`** |
| Nom distant | `20261024130000_read_estimate_version_items` |
| Application | 24/10/2026 à 15:12:45 UTC |

## Application

Préflight à 14:28 UTC : nom absent de l'historique (319 lignes, dernière version `20261024112810`), fonction absente sous toute signature ; `is_tenant_member(uuid)`, `has_tenant_role(uuid, tenant_role[])`, `auth.uid()` et les rôles `admin`/`director` présents.

La session prévue pour l'application l'a trouvée déjà faite à 15:45 UTC, sous le nom canonique, avec l'instruction exacte du fichier. Elle a été appliquée entre-temps, hors de ce fil, par le même compte Supabase. Aucune seconde application n'a été tentée.

## Vérifications

- Historique **319 → 320 lignes**, une seule ligne pour ce nom ; empreinte des 319 lignes antérieures inchangée (`9e4e185b92b208883709ccf21a06a92a`).
- `public.read_estimate_version_items(uuid, uuid)` : `SETOF estimate_items`, SECURITY DEFINER, STABLE, `search_path=""`, propriétaire `postgres`, commentaire présent ; MD5 du corps `5150bcfd606f7c2230af5af6aacfba21`, égal à la source.
- ACL `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` : `anon` et PUBLIC n'ont pas EXECUTE.
- Catalogue `public`/`private`/`storage` empreinté à 14:28 et après application : **446 → 447 fonctions**, seule celle-ci ajoutée ; 378 policies et 132 relations inchangées.
- Conseillers de sécurité : un seul constat ajouté, [SECURITY DEFINER exécutable par authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) pour cette fonction (**66 → 67**), attendu : elle restreint elle-même les lignes au périmètre de la policy. Les autres comptes restent 18 anon, 19 RLS sans policy, 1 protection des mots de passe divulgués.

## Limites

Aucun appel de la fonction ni parcours applicatif sur le partagé, aucun déploiement. Les preuves fonctionnelles restent celles de la PR #100 (`supabase/tests/database/estimate-version-items-read.test.sql`). [Rapport JSON](./shared-supabase-read-estimate-version-items-2026-10-24.json).

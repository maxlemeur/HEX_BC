# Coefficients et TVA par défaut gérés par l'admin du locataire sur le Supabase partagé — 25/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).

**Migration appliquée et vérifiée : `public.set_tenant_calc_defaults` créée, exécutable par `authenticated` et `service_role` seulement ; `set_tenant_calc_policy` reste réservée à `service_role`. Aucun déploiement dans ce reçu.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `7255d1d` (fusion de la [PR #101](https://github.com/maxlemeur/HEX_BC/pull/101)). Appliquée par Claude via l'outil MCP `apply_migration`, avec le SQL exact du fichier, sous l'autorisation permanente du porteur pour les migrations fusionnées.

| Identité | Valeur |
|---|---|
| Migration canonique | `20261025115010_tenant_calc_defaults_admin.sql` |
| Taille | **4 382 octets** |
| SHA-256 (fichier = manifeste = instruction enregistrée) | `af97469c23f3dcacf54f1802f04f9c36860e4c1e3fec6be0c3b2e2a071f91977` |
| Version distante | **`20261025135027`** |
| Nom distant | `20261025115010_tenant_calc_defaults_admin` |
| Application | 25/10/2026 à 13:50:27 UTC |

## Avant

- Historique : 330 lignes, la dernière étant `20261025112146_reconcile_shared_migration_history` (version `20261025115317`, [reçu du lot 3.3](./shared-supabase-lot-3-3-2026-10-25.md)) ; aucune ligne pour ce nom.
- `public.set_tenant_calc_defaults` absente ; commentaire de `public.tenant_calc_policies` dans sa version précédente (« Written only by public.set_tenant_calc_policy (service_role, P-13). »).

## Vérifications après application

- Historique : 331 lignes, une seule pour ce nom, en dernière position ; le SHA-256 de l'instruction enregistrée est égal à celui du fichier.
- `public.set_tenant_calc_defaults(uuid, numeric, numeric, integer[], text)` : SECURITY DEFINER, `search_path=""`, VOLATILE, propriétaire `postgres`, commentée. MD5 du corps égal à la source : `9fa86c1840078dd48ab1388ca47e7299`.
- Droits : ACL `{postgres=X,authenticated=X,service_role=X}` ; `anon` n'a pas EXECUTE, `authenticated` et `service_role` l'ont.
- `public.set_tenant_calc_policy` garde l'ACL `{postgres=X,service_role=X}` : le moteur des nouvelles versions reste hors de portée des utilisateurs connectés.
- Le commentaire de `public.tenant_calc_policies` est celui de la migration (il cite `public.set_tenant_calc_defaults (lot 3.2)`).
- Conseillers de sécurité : aucune fonction SECURITY DEFINER exécutable par `anon` ; 70 constats « exécutable par authenticated » (69 avant), le nouveau étant `set_tenant_calc_defaults`, attendu car la fonction vérifie elle-même le rôle admin du locataire (`TENANT_CALC_DEFAULTS_ADMIN_ONLY`) ; 19 tables RLS sans politique et la protection des mots de passe divulgués, inchangés.

## Limites

Aucun appel de la fonction sur le partagé et aucun déploiement : la production est restée à `d8715ed` (déploiement du 24/10 à 17:07 UTC). Les preuves fonctionnelles restent celles de la PR #101 (`supabase/tests/database/tenant-calc-defaults-admin.test.sql`, parcours V3S03). [Rapport JSON](./shared-supabase-tenant-calc-defaults-2026-10-25.json).

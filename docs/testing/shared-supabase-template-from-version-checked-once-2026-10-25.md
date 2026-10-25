# Migration de la PR #105 sur le Supabase partagé — 25/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).

**Une migration appliquée et vérifiée : `create_estimate_template_from_version` passe en SECURITY DEFINER avec `search_path` vide, et deux lectures de modèles sont ajoutées. Les trois fonctions ne sont exécutables que par `authenticated` et `service_role`. Aucune donnée modifiée, aucun déploiement dans ce reçu.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `9e009ce` (fusion de la [PR #105](https://github.com/maxlemeur/HEX_BC/pull/105)). Feu vert du porteur le 25/10 pour fusionner #105 puis appliquer sa migration.

## Migration appliquée

| Migration | PR | Octets | SHA-256 (fichier = manifeste = instruction enregistrée) | Version distante | Application (UTC) |
|---|---|---|---|---|---|
| `20261025094300_template_from_version_checked_once.sql` | #105 | 10 634 | `d4694944c622df715786e4e5a56d17bdf0916cc72f6b08a0d131be96224eb563` | `20261025111353` | 25/10/2026 11:13:53 |

Contenu lu sur `main` à `9e009ce1`, SHA-256 identique au [manifeste](../../supabase/migrations.manifest.json), transmis complet en un seul appel à `apply_migration` du MCP Supabase, qui a répondu `success`. Pas de `supabase db push`. La version distante est l'heure d'application. Une seule ligne d'historique, `created_by` = compte Supabase du porteur relié au connecteur.

## Préflight en lecture seule

- Historique : **323 lignes**, dernière version `20261024170214` ; nom cible absent.
- Migrations du dépôt : 273 sur `origin/main`. Outre la cible, les seules introuvables par nom ou version sont les trois anciennes déjà notées comme écart préexistant non bloquant (`20260714120000_preserve_assembly_cost_details`, `20260714134334_use_assembly_cost_coefficients`, le fichier vide `20260718014058_protect_takeoff_replace_with_recovery`). `20261012030743_atomic_estimate_batch` et `20261014114943_estimate_fixed_discount_and_template_parent_integrity` sont présentes en parties (`_part_1`…). Aucune autre migration de `main` en attente ; la cible ne touche aucun objet de ces trois anciennes.
- `create_estimate_template_from_version(uuid,text,text)` : SECURITY INVOKER, `search_path=public`, propriétaire `postgres`, ACL `{=X,postgres=X,anon=X,authenticated=X,service_role=X}`, corps MD5 `c4b773a18a1e2545f55d9a4cdfb0ef80`.
- `read_estimate_template_items` et `count_estimate_template_lines` : absentes.

## Après application

- Historique **323 → 324 lignes** ; empreinte des 323 lignes antérieures inchangée (`29ec2f108f466d9a5f850e7c7261c1f3`, MD5 de `version||name` triés par version).
- Instruction enregistrée : 1 instruction, SHA-256 `d4694944…eb563`, égal au fichier.
- Les trois fonctions, propriétaire `postgres`, `search_path=""`, ACL `{postgres=X,authenticated=X,service_role=X}`, `has_function_privilege` : `anon` false, `authenticated` true, `service_role` true ; plus aucune entrée PUBLIC.

| Fonction | SECURITY DEFINER | Volatilité | Retour | Corps MD5 |
|---|---|---|---|---|
| `create_estimate_template_from_version(uuid,text,text)` | oui | volatile | `uuid` | `bce44abcf62c04f5422b93cd74999695` |
| `read_estimate_template_items(uuid,uuid)` | oui | stable | `SETOF estimate_template_items` | `927ff7c25bdd799be4117378c98fdfef` |
| `count_estimate_template_lines(uuid,uuid[])` | oui | stable | `TABLE(template_id uuid, line_count integer)` | `8b669996e7f34f71d81079823927caa5` |

- Conseillers de sécurité : SECURITY DEFINER exécutable par authenticated **67 → 70**, les trois nouvelles entrées sont les trois fonctions ci-dessus, attendues (contrôle d'accès dans le corps, comme les autres aides de ce type). SECURITY DEFINER exécutable par anon 2 inchangé, 19 RLS sans policy et 1 protection des mots de passe divulgués inchangés.
- Conseillers de performance inchangés : 179 clés étrangères sans index, 155 index inutilisés, 4 policies permissives multiples, mêmes entrées.

## Limites

Aucun appel métier des fonctions sur le partagé et aucun déploiement dans ce reçu. Les preuves fonctionnelles restent celles de la PR #105. Ce reçu remplit le prérequis du déploiement de `main` à `9e009ce` ; le déploiement est fait à part par le porteur. [Rapport JSON](./shared-supabase-template-from-version-checked-once-2026-10-25.json).

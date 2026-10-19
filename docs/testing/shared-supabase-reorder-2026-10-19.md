# Application de #75 au Supabase partagé — 19/10/2026

**Migration appliquée et vérifiée : deux fonctions privées ajoutées, cinq fonctions remplacées exactement, accès des deux RPC limité aux utilisateurs connectés. Aucune donnée existante modifiée et aucun déploiement.**

Projet : `ijropnynpwjbllievrip`. Source immuable : `main` à `0163e7cf83b97a6aadcf1c19130c8cd936ffb5c9`, fusion de la [PR #75](https://github.com/maxlemeur/HEX_BC/pull/75). Le porteur autorise explicitement l'application, selon le protocole précédent et l'autorisation acquise d'utiliser Supabase.

| Identité | Valeur |
|---|---|
| Migration canonique | `20261018204500_estimate_item_order_set_based_effects.sql` |
| Taille exacte | **48 705 octets** |
| SHA-256, identique au manifeste | `54513c9d6a7f180379c436dae5332c31e2ee59d54f704d66399f5ee20e099b5b` |
| Version distante générée | **`20261019000257`** |
| Nom distant | `20261018204500_estimate_item_order_set_based_effects` |
| Application, Europe/Paris | **19/10/2026 à 02:02:57** (00:02:57 UTC) |

## Source et application

La copie préparée `4-appliquer-20261018204500.sql` n'a pas été retrouvée dans le dépôt ni les emplacements Downloads/Desktop ciblés. Le fichier canonique a été extrait de l'objet Git demandé et vérifié au manifeste. **`apply_migration` a reçu ce contenu exact complet, BEGIN/COMMIT compris** ; l'outil a créé son historique, sans ajout manuel de doublon.

Une seule tentative, réussie. Historique **309 → 310 lignes** : chaque ancienne ligne a une empreinte JSONB complète identique avant/après. Une seule nouvelle ligne, contenant une instruction de **48 705 octets au SHA-256 exact** ci-dessus. Aucun `supabase db push`, modification de branche, commit, push ou déploiement.

## Préflight en lecture seule

Dernier historique : **`20261018225702` (#72)** ; aucun enregistrement de #75, deux nouveaux helpers absents sous toute signature. Prérequis de membership, rôle, création/rejeu, reorder et move présents. Deux versions v3 et zéro politique/événement de politique, conservés après l'opération.

Les cinq corps remplacés correspondent aux dernières sources canoniques précédant #75. La répétition native confirme aussi les configurations, modes, retours et ACL des cinq prédécesseurs, sans écart.

| Fonction | Dernière source précédente | MD5 `prosrc` LF du partagé, identique à cette source |
|---|---|---|
| `private.source_coverage_invalidate` | `20261018013249_estimate_creation_set_based_item_effects.sql` | `56d6d08dfb5e6f2834d0cd8c91c131b0` |
| `public.bump_estimate_content_revision_from_item` | même source M6b | `c70f431f090793ce61020bc0f389e55f` |
| `public.log_estimate_audit` | même source M6b | `4f15e16cd95af198c7510d96b4e20b74` |
| `public.move_estimate_item` | `20260304212000_est125_hierarchy_depth_compat_fix.sql` | `7c3923767ca60f700e511e75e1c35231` |
| `public.reorder_estimate_items` | `008_atomic_reorder_estimate_items_s4.sql` | `29225c4c1153cd5fd934534584dda77c` |

Aucune dérive cachée des trois fonctions de déclencheur n'a donc été écrasée.

## Répétition et preuves locales

Archive Git du SHA demandé, source extraite dans un répertoire Linux temporaire. Dépendances natives réutilisées depuis `miaouffrage-reorder` après comparaison **à l'octet près du lockfile**, sans modifier les sources de ce checkout.

Pile possédée sans #75 : cinq prédécesseurs identiques au partagé ; application du fichier exact ; sept corps conformes à la source ; capture des configurations, modes, retours, ACL et attributs attendus. Un second passage local échoue avec « already exists » et ne modifie pas le catalogue cible.

**38 assertions ciblées, sans skip, réussies** : équivalence des dispositions, révisions et audits sur v2/v3, refus d'acteurs et de statuts, permissions, couverture des sources, portée/restauration des contrats et non-régression des écritures hors opération.

La chaîne finale **`npm run db:ci:local` termine avec le code 0 : 28 fichiers pgTAP / 2 045 assertions PASS et matrice RLS comportementale PASS**. Piles arrêtées/détruites, workdirs de base retirés. Node WSL `24.14.0`, Supabase CLI épinglée `2.120.0`, PostgreSQL `17.11` ; l'avis de mise à jour CLI n'a provoqué aucun changement de version. Contrôles de capacité, isolation des ports et refus de secrets distants conservés.

Revue indépendante statique en lecture seule : aucun défaut concret bloquant, 19 instructions de premier niveau sans DML exécuté à l'application ; les corps de déclencheur M6b sont intégralement conservés avec les seuls ajouts annoncés.

La revue finale indépendante des deux rapports et des 35 empreintes de preuves ne relève aucun défaut ni secret ; catalogue, historique, données, tests et limites concordent.

## Catalogue et droits après application

Les **sept corps `prosrc` complets sont exactement égaux à la source**, et les sept fiches de catalogue correspondent à l'oracle canonique : `proconfig`, SECURITY DEFINER, volatilité, STRICT, parallélisme, retour, ACL, propriétaire, langage, arguments/défauts, commentaire et leakproof.

| Cible | MD5 LF final |
|---|---|
| `private.estimate_item_order_writer_tenant` | `5c4668006e797782ce09bf2a826d86a8` |
| `private.estimate_item_order_replay_effects` | `d9f3d2bff5bf1827581848e10ff9ad67` |
| `public.reorder_estimate_items` | `0d065a30ca10f26a5b25ceabe697276b` |
| `public.move_estimate_item` | `08d081822f4b2fb6abaaed9aa5a6d419` |
| `public.log_estimate_audit` | `a0e3d422a4a2b1904b00556ba571f944` |
| `public.bump_estimate_content_revision_from_item` | `0e96dcab7d067d0cba371e8289bb6e42` |
| `private.source_coverage_invalidate` | `a3c054c5ef22ca8252b6ce8cb3a589af` |

- Deux RPC : EXECUTE pour **`authenticated` seulement parmi les rôles API** ; `anon`, PUBLIC et `service_role` n'ont plus ce droit. Les propriétaires gardent leurs droits normaux.
- Deux helpers privés : aucun EXECUTE pour les rôles API ou PUBLIC. `search_path=""` pour ces helpers et les deux RPC.
- Les ACL et configurations des trois fonctions de déclencheur sont conservées conformément à la source ; aucune permission supplémentaire n'a été modifiée hors du fichier.
- **413 fonctions hors lot inchangées**, corps, configurations, modes, retours, droits et autres attributs compris ; gardes M1/M4, création M8, copie #72 et batch writer 2.8b conservés.
- **122 relations inchangées** : colonnes/défauts, contraintes/validation, index, définitions des déclencheurs, RLS, politiques, ACL et commentaires. La migration remplace les corps de trois fonctions de déclencheur ; elle ne change aucune définition de déclencheur.

## Données et conseillers

**122 tables / 39 699 lignes d'origine : empreintes et comptes identiques avant/après**, sans exclure une colonne ni une ligne. Méthode : MD5 par ligne `to_jsonb(row)::text`, concaténation ordonnée des MD5 puis MD5 par table, nombre de lignes indépendant. Périmètre `public`/`private` ; `auth`, `storage` et l'historique technique `supabase_migrations` sont exclus.

Les deux v3 existantes restent identiques, zéro politique et zéro événement de politique. Aucun appel métier reorder/move/copie, fixture distante, conversion de devis, politique ou déploiement n'a été effectué.

Conseillers comparés hors `observed_at` : seuls deux diagnostics attendus [SECURITY DEFINER accessible à authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) apparaissent, pour les deux RPC (**64 → 66**). Leurs contrôles acteur/tenant/rôle/propriétaire/brouillon sont exécutés en pgTAP local. Les autres comptes restent 17 RLS sans politique, 18 SECURITY DEFINER accessibles à anon et 1 protection des mots de passe divulgués. Le compte anon du conseiller ne diminue pas : les anciennes RPC étaient SECURITY INVOKER, et n'y figuraient pas ; leurs droits effectifs ont bien été retirés.

## CI et limites

La [PR #75](https://github.com/maxlemeur/HEX_BC/pull/75) est fusionnée au SHA demandé ; ses contrôles applicables sont réussis : [critique et métré](https://github.com/maxlemeur/HEX_BC/actions/runs/39177622995), [qualité](https://github.com/maxlemeur/HEX_BC/actions/runs/39177623007), [RLS](https://github.com/maxlemeur/HEX_BC/actions/runs/39177622988), [smoke](https://github.com/maxlemeur/HEX_BC/actions/runs/39177623047). Build est ignoré dans cette sélection.

[Rapport JSON](./shared-supabase-reorder-2026-10-19.json). Preuves sous `.e2e/shared-supabase-reorder-20261019/` : sources et archive, cinq prédécesseurs, catalogues complets avant/après, sept corps distants, données et historique empreintés, tests, conseillers et application.

Aucun nouveau parcours UI, export, courriel ni benchmark n'a été exécuté. Les preuves métier/performance de développement restent celles de [reorder-move-large-v2.md](./reorder-move-large-v2.md), avec leurs limites ; cette application ne les renouvelle pas. Pas d'affirmation d'équivalence globale du schéma partagé historique avec main : seules les cibles sont rapprochées au canonique, et le reste est vérifié inchangé.

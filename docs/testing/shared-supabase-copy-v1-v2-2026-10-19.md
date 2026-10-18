# Application de #72 au Supabase partagé — 19/10/2026

**Migration appliquée et vérifiée. Une seule nouvelle fonction ; aucune donnée existante ni définition antérieure modifiée. Aucun déploiement.**

Projet : `ijropnynpwjbllievrip`. Source de `main` : `d90e158df0aea23cb12dfe509f912497f691851e`, fusion de la [PR #72](https://github.com/maxlemeur/HEX_BC/pull/72). Application explicitement autorisée par le porteur, qui a ensuite autorisé le plugin Supabase.

| Identité | Valeur |
|---|---|
| Migration canonique | `20261018193516_estimate_copy_items_set_based.sql` |
| Taille | **12 203 octets** |
| SHA-256, identique au manifeste | `abca15875f904aac7459afa5ba47134288f6098d9e6bcba951eb74ee85ae5365` |
| Version distante générée | **`20261018225702`** |
| Nom distant | `20261018193516_estimate_copy_items_set_based` |
| Application, Europe/Paris | **19/10/2026 à 00:57:02** (18/10 à 22:57:02 UTC) |

## Source et méthode

La copie nommée `3-appliquer-20261018193516.sql` n'était pas accessible dans le dépôt ni dans les emplacements Downloads/Desktop ciblés. Le fichier canonique a été extrait de l'objet Git de `origin/main` ci-dessus et son SHA vérifié au manifeste. Le porteur permettant Supabase, l'application a utilisé **`apply_migration` avec ce fichier complet exact**, BEGIN/COMMIT compris. L'outil a créé l'historique ; aucune insertion manuelle supplémentaire n'a été faite.

Une seule tentative, réussie. L'historique est passé de **308 à 309 lignes**, les métadonnées contrôlées des anciennes entrées restant identiques ; l'unique nouvelle entrée contient une instruction, **12 203 octets et le SHA-256 exact** ci-dessus. Aucun `supabase db push`. La copie locale principale est restée sur sa branche et son SHA initiaux ; aucun pull, commit ou push.

## Préconditions en lecture seule

- Aucun `copy_estimate_items_atomic` sous quelque signature que ce soit et aucun enregistrement préalable de cette migration.
- 2.8b (`20261018191755`) et M8 (`20261018191853`) présentes, avec les SHA exacts des fichiers canoniques déjà appliqués.
- Rejeu avec la borne `greatest(item_count, target_max_depth)`, fonctions de membership/rôle et colonne `draft_locks.session_id` présents.
- Les quatre prédécesseurs (canonisation, batch writer, rejeu, création atomique M8) correspondent à l'oracle canonique local : corps, configuration, modes, retour et ACL, zéro écart.
- Deux versions v3 préexistaient à cette opération ; zéro politique et zéro événement de politique. Ces comptes et toutes leurs données restent identiques après application.

## Répétition et validation locale

Source immuable extraite dans un répertoire Linux temporaire. Une première préparation s'est arrêtée à la comparaison des lockfiles, avant tout démarrage de base. Le runtime de `miaouffrage-rowlimit2` avait ensuite un lockfile **identique à l'octet près** ; seules ses dépendances ont été réutilisées, sans modifier les sources d'un autre checkout.

Sur une pile native jetable reproduisant les migrations précédentes : quatre prédécesseurs identiques au partagé, application du fichier exact, fonction conforme au canonique et prédécesseurs conservés. Un second passage **local** est refusé avec « already exists » et laisse le catalogue cible inchangé. Les **22 assertions ciblées**, sans skip, passent (autorisation, équivalence des lignes/montants/révisions/audits, fusion, profondeur, bail, v3 refusée et copie de 1 000 éléments).

La chaîne finale **`npm run db:ci:local` termine avec le code 0 : 27 fichiers pgTAP, 2 005 assertions PASS et matrice RLS comportementale PASS**. Les piles natives possédées sont arrêtées, détruites et leurs workdirs retirés. Les contrôles de capacité/ports et de refus d'environnement distant sont conservés.

La revue indépendante en lecture seule n'identifie aucun défaut concret bloquant. La revue finale des deux rapports et des 24 empreintes de preuves ne relève aucun défaut ni secret. Aucun test, code applicatif, dépendance ou migration suivi n'a été modifié pour cette opération.

## Vérifications après application

- Une seule fonction ajoutée : `public.copy_estimate_items_atomic(uuid,uuid,jsonb)`. **`prosrc` égal à la source complète**, MD5 LF `d857de22a6c9a1423155bb9d582470c7`, `search_path=""`, retour `jsonb`, PL/pgSQL, SECURITY DEFINER, propriétaire `postgres`, modes et commentaire conformes.
- EXECUTE pour **`authenticated` seulement parmi les rôles API** ; refus pour `anon`, `service_role` et PUBLIC. Le propriétaire garde son droit normal.
- **417 fonctions existantes inchangées**, corps, configurations, ACL et modes compris ; leurs propriétaires, langages, arguments/défauts, commentaires et attributs leakproof également identiques. Cela inclut les gardes M1/M4, le batch writer 2.8b et la création M8.
- **122 relations inchangées** : colonnes, contraintes et validation, index, déclencheurs, RLS, politiques, droits et commentaires.
- **122 tables / 39 699 lignes d'origine inchangées**, empreintes et nombres identiques avant/après. MD5 par ligne `to_jsonb(row)::text`, concaténation ordonnée des MD5, puis MD5 par table et nombre indépendant ; aucune colonne ni ligne exclue. Périmètre `public`/`private` ; `auth`, `storage` et l'historique technique des migrations ne sont pas inclus.
- Aucun appel de la RPC de copie, fixture distante, politique de calcul, conversion de devis ou déploiement.

## Conseillers et CI

Les conseillers, comparés sans leur horodatage d'observation, ajoutent uniquement l'avertissement attendu [SECURITY DEFINER accessible aux utilisateurs connectés](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) pour la nouvelle RPC : **63 → 64**. Elle vérifie acteur, tenant actif, rôle, propriétaire/admin, brouillon v1/v2 et bail/session avant toute écriture ; ses refus sont exécutés dans le pgTAP local. Aucun nouveau droit anonyme. Les autres comptes restent **17** RLS sans politique, **18** fonctions accessibles à anon et **1** protection des mots de passe divulgués.

La PR #72 est fusionnée au SHA source, avec les contrôles applicables réussis : [qualité](https://github.com/maxlemeur/HEX_BC/actions/runs/39163801536), [critique et métré](https://github.com/maxlemeur/HEX_BC/actions/runs/39163801506), [RLS](https://github.com/maxlemeur/HEX_BC/actions/runs/39163801529), [smoke](https://github.com/maxlemeur/HEX_BC/actions/runs/39163801460). Le job Build est ignoré dans cette sélection ; aucun build ou déploiement n'est revendiqué ici.

## Preuves et limites

[Rapport JSON](./shared-supabase-copy-v1-v2-2026-10-19.json), catalogue et empreintes avant/après, preuves natives et journaux sous `.e2e/shared-supabase-copy-v1-v2-20261019/`.

Aucun parcours UI, PDF, courriel ou copie de production n'a été exécuté ; aucun nouveau gain de performance n'est mesuré par cette application. L'équivalence globale du schéma partagé historique avec main n'est pas revendiquée : seuls les prédécesseurs ciblés et la nouvelle fonction sont rapprochés au canonique ; le reste est vérifié conservé.

# Supabase partagé : réserves d'offre et trois reçus antérieurs

Toutes les heures ci-dessous sont en UTC, le 11 novembre 2026.

La migration [`20261111193950_estimate_line_offer_choice.sql`](../../supabase/migrations/20261111193950_estimate_line_offer_choice.sql) de la [PR #231](https://github.com/maxlemeur/HEX_BC/pull/231), source `ddb100d045341d68b4e4c67347d5433073e109bb`, a été appliquée et vérifiée sur **bon_de_commande**, base partagée qui sert aussi la production. Autorisation explicite donnée dans la tâche, avec l'accord de Thanh. **Une seule migration appliquée dans cette intervention ; aucun déploiement.**

Le [reçu structuré](./shared-supabase-offer-choice-2026-11-11.json) conserve les empreintes, contrôles de catalogue, droits, requêtes de relecture et limites. La référence technique du projet et les données métier sont omises.

## Application et historique

- Avant : **378 entrées**, dernière `20261111200530` (`estimate_site_cost_origin`), colonne `estimate_items.offer_choice` absente.
- Les **324 fichiers** de migrations de `ddb100d` ont été comparés à l'historique : 321 correspondances directes, deux représentations historiques découpées dont toutes les parties sont présentes, et la seule migration autorisée en attente. Ces représentations figurent dans le [reçu précédent](./shared-supabase-ti682-lot-b-2026-11-11.json) ; elles n'ont pas été rejouées.
- `origin/main` avait avancé à `23a4f1d3c91946bfe33073019b522aba0642e8b1`, sans changer les fichiers de migrations. La worktree du reçu a été créée à cette révision, puis avancée à `753c1786c61a592abcbb0b86568b2a7c56ddb331` avant commit, sans modification de ces migrations ; le SQL appliqué reste le blob exact de `ddb100d`.
- Premier appel MCP : confirmation expirée. Avant de réessayer, relecture à **22:57:00 UTC** : toujours 378 entrées, même empreinte de toutes les lignes d'historique, aucune entrée ni colonne de réserve.
- Second appel `apply_migration` : succès, **une entrée** distante `20261111225859`, nom `20261111193950_estimate_line_offer_choice`. Le SQL complet est stocké dans une seule instruction, sans réécriture ni découpage : **58 864 octets**, SHA-256 `4818a1ef1a14812305e2bc91310f1cb9717fab297178b6fd722113cda4c560f3`, identiques au fichier et au manifeste.
- Après, à **22:59:30 UTC** : **379 entrées**, les **378 lignes précédentes inchangées**, aucune autre migration ajoutée ; les 324 fichiers sont couverts. Aucun `db push` exécuté.

## Objets vérifiés

- `estimate_items.offer_choice` : `jsonb`, nullable, sans défaut ; `estimate_items_offer_choice_check` présente et validée.
- Déclencheurs actifs : `af_clear_estimate_item_offer_choice` sur les lignes et `record_estimate_offer_choices_on_sent` sur les événements `sent`.
- Les cinq corps de fonction correspondent exactement au SQL source par SHA-256 : `estimate_offer_choice_valid`, `clear_estimate_item_offer_choice`, `set_estimate_line_offer_choice`, `record_estimate_offer_choices_on_sent` et la nouvelle définition de `commit_estimate_batch`.
- La RPC d'écriture est exécutable par `service_role` seulement parmi les rôles API ; les deux fonctions privées de déclencheur n'y sont pas exécutables. Les ACL de `commit_estimate_batch` sont inchangées. Tous les chemins de recherche sont vides, conformément aux définitions.
- Quatre appels de la fonction pure de validation ont réussi : réserve valide sur `not_priced`, refus sur `priced`, refus d'une base inconnue et refus du code `other` sans note. Aucune écriture de données métier pour les contrôles.

## Reçus des trois applications antérieures

Ces trois migrations étaient **déjà appliquées** avant cette intervention. Leurs reçus sont réconciliés après coup depuis l'historique distant et le catalogue courant ; elles n'ont pas été réappliquées.

| PR | Fichier | Version distante | Octets du SQL enregistré |
| --- | --- | --- | ---: |
| [#222](https://github.com/maxlemeur/HEX_BC/pull/222) | [`20261111144803_estimate_line_status_reason.sql`](../../supabase/migrations/20261111144803_estimate_line_status_reason.sql) | `20261111200426` | 69 958 |
| [#223](https://github.com/maxlemeur/HEX_BC/pull/223) | [`20261111155627_estimate_line_nature_pose_only.sql`](../../supabase/migrations/20261111155627_estimate_line_nature_pose_only.sql) | `20261111200515` | 39 114 |
| [#229](https://github.com/maxlemeur/HEX_BC/pull/229) | [`20261111181152_estimate_site_cost_origin.sql`](../../supabase/migrations/20261111181152_estimate_site_cost_origin.sql) | `20261111200530` | 12 029 |

Chaque entrée contient une seule instruction dont la taille et le SHA-256 correspondent au fichier complet et au manifeste. Les trois PR sont fusionnées ; leurs commits et empreintes figurent dans le JSON. Le lot désigné « 20:04 UTC » dans la tâche porte les versions **20:04:26**, **20:05:15** et **20:05:30** ; ces heures sont déduites des versions Supabase, sans prétendre retrouver les journaux d'appel originaux.

La relecture actuelle confirme `status_reason`, `was_not_priced`, leur contrainte et leur déclencheur ; la valeur d'énumération `pose_only` ; la contrainte d'origine FO et le déclencheur de provision. Les **12 corps de fonction** concernés par les quatre fichiers correspondent à leur dernière définition propriétaire : notamment les fonctions de lot et de duplication de #223, le contrat client de #223, la provision de #229 et le lot de #231.

Les précontrôles originaux, avis de sécurité avant/après et éventuels comptes de lignes précédant ces trois anciennes applications ne sont pas récupérés ici. La preuve rétrospective ne les remplace pas.

## Avis de sécurité

Les **95 constats sont identiques avant et après cette application**, après comparaison de la règle, du niveau, des métadonnées et du détail, hors horodatage d'observation. Aucun constat ajouté ou supprimé.

| Règle | Niveau | Avant | Après |
| --- | --- | ---: | ---: |
| [RLS activée sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | INFO | 24 | 24 |
| [SECURITY DEFINER exécutable par authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | WARN | 70 | 70 |
| [Protection des mots de passe compromis désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | WARN | 1 | 1 |

Ces avis préexistants restent ouverts ; cette tâche n'autorise pas leur correction.

## Portée et récupération

Contrôles distants de schéma, historique, empreintes, privilèges et validation pure uniquement. Aucun parcours navigateur ni envoi réel exécuté sur la production ; les campagnes fonctionnelles de #231 restent celles de cette PR. Le reçu documentaire ne change aucun code, migration, variable ou accès. Vérification locale : cohérence du contenu, liens, empreintes et `git diff --check` ; aucune suite applicative nécessaire pour ces deux fichiers.

Les résultats bruts du catalogue et des advisors restent dans `outputs/shared-supabase-offer-choice-20261111` du clone canonique, hors Git. Le [runbook](../../supabase/README.md#appliquer-sur-une-base-partagée) décrit la procédure suivie.

Aucun retour arrière exécuté. Retirer les objets ou les réserves de brouillon demanderait une nouvelle migration et son autorisation ; annuler ce reçu dans Git ne change pas la base.

# Base partagée · conditionnements de vente et modèles de consultation fournisseur

Les deux migrations autorisées le 22 novembre 2026 ont été appliquées au premier appel sur la base partagée de MergeOne. Le SQL enregistré est identique aux deux fichiers des PR sources, octet par octet, dernier saut de ligne inclus. La vérification a porté sur le catalogue, les droits effectifs et l’historique. Aucune écriture métier, activation ou livraison applicative n’a accompagné l’opération. [Reçu JSON](./shared-supabase-packagings-consultation-templates-2026-11-22.json)

| Migration et source figée | Version distante | Application UTC | Octets source et stockés | SHA-256 commun au fichier, au manifeste et au SQL enregistré |
| --- | --- | --- | ---: | --- |
| Conditionnements · [PR #462](https://github.com/maxlemeur/HEX_BC/pull/462) · [`614ee4bda`](https://github.com/maxlemeur/HEX_BC/blob/614ee4bda07aea203d3ea945e6ea1d8f0fe61ec8/supabase/migrations/20261122092341_product_packagings.sql) | `20261122105334` | 10:53:34 | 12 544 | `493d46cf320322c8cd2e77c87fe55daadbf61d73f8b5339e308978ebacaef20c` |
| Modèles de consultation · [PR #463](https://github.com/maxlemeur/HEX_BC/pull/463) · [`5a15da81c`](https://github.com/maxlemeur/HEX_BC/blob/5a15da81ceb2fae6f3d200d37e61ba99bd8e91a9/supabase/migrations/20261122093228_material_request_message_templates.sql) | `20261122105354` | 10:53:54 | 13 650 | `2d9fc87c12d90c2cae7ea0b1c5aac62ce770924cd2501e1f9b79d0a5d2a5e0ac` |

## Historique et prérequis

L’historique est passé de **424 à 426 lignes**. Les 424 couples version/nom antérieurs sont identiques. Les empreintes des 407 premières lignes, du SQL de la ligne 408 et de celui de la ligne 424 correspondent aux reçus antérieurs. Les heures d’application sont celles des versions UTC attribuées par Supabase. [Reçu du 21 novembre](./shared-supabase-v080-and-takeoff-lot2-2026-11-21.md) · [Reçu de l’envoi partiel, ligne 424](./shared-supabase-takeoff-partial-send-2026-11-22.md)

Parmi les 369 fichiers SQL du commit de comparaison `4137873f0`, deux se retrouvent sous des noms fractionnés dans l’historique : `atomic_estimate_batch` en deux parties et `estimate_fixed_discount_and_template_parent_integrity` en neuf. Au total, 52 lignes distantes, dont ces onze parties, n’ont pas de fichier de même nom après rapprochement des préfixes de version. Le JSON en donne la liste. Aucun rattrapage d’historique n’a été effectué.

À 10:53:18 UTC, les relations, les fonctions et la clé unique d’adhésion requises par les deux précontrôles étaient présentes. Les trois tables, les cinq fonctions et la nouvelle contrainte étaient absentes. Aucune entrée d’historique ne correspondait aux migrations par nom ou par instruction de création. Sur `products`, la clé primaire porte sur `id`, `unit` est obligatoire et aucun groupe `(id, tenant_id, unit)` n’était dupliqué. Aucune autre session ne détenait de verrou sur la table.

## Contrôles après application

Les trois tables ont la RLS **activée et forcée**. Le rôle `anon` ne dispose d’aucun droit effectif sur leurs tables ou colonnes, ni d’aucun droit d’exécution sur les cinq fonctions. Les neuf politiques visent `authenticated`. Les deux déclencheurs attendus sont actifs avant insertion ou mise à jour. Le corps des cinq fonctions correspond au fichier source.

| Objet | Résultat vérifié |
| --- | --- |
| `product_packagings` | Quatre politiques. Les membres lisent les conditionnements de leur tenant. Ajouter, modifier et supprimer exigent le tenant actif et le droit de modifier l’article. Le déclencheur `enforce_product_packaging_write` est actif. La contrainte unique de `products (id, tenant_id, unit)` et la clé étrangère depuis `(product_id, tenant_id, unit)` sont validées, avec `ON UPDATE RESTRICT` et `ON DELETE CASCADE`. |
| `material_request_message_templates` | Quatre politiques limitent les quatre opérations à la ligne du membre connecté dans son tenant actif. Le déclencheur `enforce_material_request_message_template_write` est actif. La clé vers l’adhésion supprime le modèle en cascade. |
| `tenant_consultation_message_templates` | Une politique de lecture dans le tenant actif. Pour `authenticated`, seules les colonnes `tenant_id`, `message_template` et `line_template` sont lisibles. `updated_by` et `updated_at` sont inaccessibles. Aucune insertion, modification ou suppression directe. |
| RPC publiques `save_tenant_consultation_message_template` et `reset_tenant_consultation_message_template` | Toutes deux sont `SECURITY DEFINER` avec un `search_path` vide. Le droit `EXECUTE` est accordé à `authenticated` et `service_role`, refusé à `PUBLIC` et `anon`. Les corps vérifiés appellent la fonction privée qui exige une adhésion admin de l’appelant dans son tenant actif. |

**Écart de droits pour le rôle serveur.** Sur les trois tables, `service_role` conserve les huit privilèges de table accordés par défaut dans le schéma `public`. Les migrations révoquent les privilèges de `PUBLIC`, `anon` et `authenticated` et conservent ceux de `service_role`. Sur le modèle personnel, le fichier accorde explicitement `SELECT` et `DELETE`, mais le rôle dispose aussi de `INSERT`, `UPDATE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` et `MAINTAIN`. Le déclencheur exige une identité utilisateur pour insérer ou modifier. Aucun essai d’écriture ni correctif de droits n’a été exécuté sur la base partagée.

## Avis de sécurité

Le reçu de l’envoi partiel indiquait zéro nouveau constat. La comparaison effectuée juste avant et après ces deux applications relève **deux nouveaux WARN** : les deux RPC publiques ci-dessus sont exécutables par `authenticated`. Cette catégorie passe de 89 à 91. Aucun autre constat ajouté ou retiré, y compris sur les conditionnements. [Fiche de l’advisor Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

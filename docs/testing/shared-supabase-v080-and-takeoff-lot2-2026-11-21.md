# Base partagée · migrations v0.8.0 et takeoff du 21 novembre 2026

**Sept migrations appliquées et vérifiées** entre 06:41:49 et 06:51:31 UTC. L’historique est passé de 408 à 415 lignes. Les avis de fin d’analyse restent désactivés. Aucun déploiement ni changement de flag n’a accompagné l’intervention. [Résultats et empreintes par fonction](./shared-supabase-v080-and-takeoff-lot2-2026-11-21.json)

## Source et identité du SQL

Les sept fichiers ont été lus sur `origin/main` au commit `dff50c2e1d3ea67e57c53e9572f51d80010cbf84`. Pour chacun, le SQL enregistré a le nombre d’octets et le SHA-256 du fichier complet, **dernier LF inclus**. Le contrôle suivant chaque application a retrouvé exactement la référence initiale et les nouvelles lignes dans l’ordre attendu. [Manifeste des migrations](../../supabase/migrations.manifest.json)

| Migration | PR et commit fusionné | Version distante | UTC | Octets | SHA-256 du fichier et du SQL enregistré |
| --- | --- | --- | --- | ---: | --- |
| [Références fournisseur](../../supabase/migrations/20261117193734_workbook_supplier_references.sql) | [#369](https://github.com/maxlemeur/HEX_BC/pull/369) `aed97d3bf` | `20261121064149` | 06:41:49 | 10091 | `3d95a24e2400d5a44dc22dd2c42bc877d01079f81dab524760b454a2bf321f45` |
| [Retrait du prix de référence](../../supabase/migrations/20261117195542_product_reference_price_withdrawal.sql) | [#370](https://github.com/maxlemeur/HEX_BC/pull/370) `dfbcf7a95` | `20261121064717` | 06:47:17 | 14463 | `22d213fd5c8ef66ce88e8e089c87ee659d1fac1fdb4aa888a7d6593400f18d8c` |
| [Nettoyage des pièces des demandes](../../supabase/migrations/20261117200342_material_request_affaire_storage_cleanup.sql) | [#372](https://github.com/maxlemeur/HEX_BC/pull/372) `d8d2e412e` | `20261121064816` | 06:48:16 | 9701 | `d05d03911ffe7f86b54fa46c7415f46e49fd8d40efad92e5f53cd00d22a75737` |
| [Commandes dans le coût d’approvisionnement](../../supabase/migrations/20261117201102_estimate_orders_in_affaire_supply_cost.sql) | [#371](https://github.com/maxlemeur/HEX_BC/pull/371) `8eeeb09f9` | `20261121064859` | 06:48:59 | 12436 | `f6b4bc854ac5e30f2898251748259e7ed2c20f66796473d14419b7ae899b1e57` |
| [M1 · rattachement à l’affaire](../../supabase/migrations/20261120204437_takeoff_jobs_by_affaire.sql) | [#413](https://github.com/maxlemeur/HEX_BC/pull/413) `ab72179db` | `20261121064932` | 06:49:32 | 60289 | `1194ff733be5a1cc0c294c8af103e3ad6d8b908cec8f55f3cae42bd673b5075e` |
| [M3 · fin d’analyse](../../supabase/migrations/20261121011212_takeoff_analysis_completion.sql) | [#415](https://github.com/maxlemeur/HEX_BC/pull/415) `025226d74` | `20261121065044` | 06:50:44 | 37029 | `fe686c48545e814dbc9b25c9db49d1ad5ea22766b6c9c56761a32ed9494d1cb2` |
| [Conditions avant activation](../../supabase/migrations/20261121020321_takeoff_completion_before_activation.sql) | [#425](https://github.com/maxlemeur/HEX_BC/pull/425) `089608f04` | `20261121065131` | 06:51:31 | 37669 | `dbab0169bda43ff551d1973595106165d981171ccf3f5bda9295427a7c9cefc3` |

L’empreinte des 407 premières lignes reste `8a37267e2f68e79acd5d4f1a3e6c5834d230ff71db9a12fbec90397c17d5debb`. La ligne 408, version `20261115223706`, conserve le SHA-256 `eb1b0c1ceee7ac0ae0a6f909c83ed924dc512217b9bfa2d8403add8bbcd8ca84`. Le dernier inventaire a retrouvé les 408 mêmes couples version/nom, suivis des sept versions ci-dessus. [Calcul de référence du 15 novembre](./shared-supabase-intake-transcriptions-2026-11-15.md)

## Contrôles de données, de compatibilité et de catalogue

Les quatre premières migrations ne fixent aucun délai d’attente de verrou. Juste avant chacune, la lecture des verrous et transactions ne montrait aucune session concurrente sur les relations contrôlées. TI-709 contient sa transaction explicite. TI-711, TI-695 et TI-714 ont été transmises chacune en un seul appel multi-instructions, pour lequel Supabase documente une annulation complète en cas d’échec. Les trois migrations takeoff fixent leur délai à cinq secondes. Chaque application a réussi au premier appel. [Garantie documentée de la Management API](https://supabase.com/docs/guides/integrations/supabase-for-platforms)

- **Références fournisseur.** 186 références existantes, 0 violation de la contrainte avec la valeur par défaut. Le booléen obligatoire vaut false par défaut, le contrôle est validé et le déclencheur est actif. Les nouvelles références en attente bloquent leur activation incidente, le changement de SKU ou d’URL et leur usage par un prix. Le chemin d’édition de la v0.7.0 conserve les références existantes.
- **Retrait du prix de référence.** Le journal des retraits était absent, donc aucune ligne existante à contraindre. Ses quatre clés étrangères, ses contrôles de valeur, ses deux index, la RLS, la politique et le droit SELECT des membres sont en place. Le garde conserve la validation de prix de la v0.7.0 et admet désormais un retrait justifié par une écriture du même acteur dans la même transaction.
- **Nettoyage des pièces des demandes.** L’outbox était vide. Zéro clé de pièce existante incompatible avec la nouvelle contrainte. Les trois colonnes de provenance, le contrôle de cible, l’index partiel, la politique de lecture et le déclencheur de suppression sont en place. Une clé retirée ne peut plus recevoir de nouveaux octets. Le worker de la v0.7.0 conserve son périmètre devis. Le traitement des nouvelles suppressions de photos requiert le worker compatible.
- **Commandes dans le coût d’approvisionnement.** Sur 17 commandes, zéro source de devis et zéro transfert enregistré. Aucune contrainte de ligne ajoutée. Le nouveau déclencheur protège le rattachement au devis et contrôle le droit d’achat et l’affaire. La v0.7.0 crée ses brouillons par la RPC de transfert. Les deux fonctions et le remplacement du déclencheur ont été vérifiés.
- **M1 · rattachement à l’affaire.** Zéro job incohérent et zéro job en traitement. La table des jobs était vide avant et après le rattachement. Les clés d’affaire et de jeu de plans, l’index, les déclencheurs et les 23 politiques d’accès aux jobs, résultats, plans et objets Storage ont été contrôlés.
- **M3 · fin d’analyse.** Zéro job en traitement et zéro violation des nouvelles contraintes. Les colonnes de fin d’analyse, la table des avis, ses index, sa politique, les droits de colonne et les déclencheurs sont en place. La table d’activation et la table des avis comptaient chacune zéro ligne.
- **Conditions avant activation.** Les tables privées de présence du Mac, de travail par job et de début de capture ont les colonnes, contraintes, index et droits prévus. Les délais par défaut sont 15 minutes et 24 heures. Le motif public est lisible sur l’avis. La relance est réservée au lanceur dès cette migration. Aucun job existant n’était susceptible d’être refusé par ce nouveau garde.

Pour les sept étapes, 64 définitions de fonction ont été vérifiées par comparaison du MD5 du corps PostgreSQL avec le texte entre délimiteurs dans le fichier. Une fonction remplacée à deux étapes est comptée à chaque étape. Les contrôles couvrent aussi les privilèges d’exécution et les objets de catalogue concernés. Aucun scénario applicatif d’écriture n’a été exécuté sur la production.

## Avis de sécurité

L’advisor rapporte quatre WARN supplémentaires dans la catégorie des fonctions `SECURITY DEFINER` exécutables par `authenticated`, passée de 81 à 85 constats. Les rôles et les portées de tenant sont contrôlés dans les fonctions. [Fiche de l’advisor Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

| Fonction signalée | PR concernée |
| --- | --- |
| `public.import_workbook_supplier_references` | [#369](https://github.com/maxlemeur/HEX_BC/pull/369) |
| `public.withdraw_product_reference_price` | [#370](https://github.com/maxlemeur/HEX_BC/pull/370) |
| `public.list_affaire_takeoff_completions` (signature finale à quatre arguments) | [#415](https://github.com/maxlemeur/HEX_BC/pull/415) et [#425](https://github.com/maxlemeur/HEX_BC/pull/425) |
| `public.mark_takeoff_completion_notification_read` | [#415](https://github.com/maxlemeur/HEX_BC/pull/415) |

## État avant activation

À 06:52:01 UTC, `private.takeoff_completion_activation` comptait **0 ligne**, `private.takeoff_requester_capture` **1 ligne** et la table des avis **0 ligne**. La requête préalable de la PR #425 sur les analyses ouvertes et relancées sans demandeur connu a renvoyé **0 ligne**, donc aucun identifiant à traiter.

L’ordre des trois migrations et l’absence de date d’activation sont vérifiés. Avant toute activation ultérieure, il reste à déployer et vérifier l’application compatible chez l’hébergeur et sur le Mac autorisé, à laisser se terminer les anciennes écritures, puis à revérifier que la requête préalable renvoie toujours zéro ligne. [Conditions de la PR #425](https://github.com/maxlemeur/HEX_BC/pull/425)

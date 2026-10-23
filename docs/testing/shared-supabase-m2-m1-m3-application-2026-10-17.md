# Application Supabase partagée — 17/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).


**Les six migrations autorisées ont été appliquées et vérifiées, dans l'ordre demandé. Aucun déploiement, commit ou push.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`, connexion `max`). Sources : `main` à `b91f938fa6e36db27a472cba095693553d1a41fe`. Fin du contrôle : 2026-10-17 18:07:10 UTC.

## Historique effectivement enregistré

| Ordre | Source immuable | Version distante générée par MCP | Résultat |
|---|---|---|---|
| 1 | `20261011083209_transactional_estimate_purchase_preparation.sql` | `20261017174200` | Vérifiée |
| 2 | `20261011091744_purchase_decimal_quantities_and_stable_edits.sql` | `20261017175103` | Vérifiée |
| 3 | `20261013130248_estimate_offer_client_contract.sql` | `20261017175932` | Vérifiée |
| 4 | `20261017093407_supplier_offer_zero_price_policy.sql` | `20261017180142` | Vérifiée |
| 5 | `20261017113844_estimate_calc_engine_v3_fail_closed.sql` | `20261017180514` | Vérifiée |
| 6 | `20261017134443_estimate_engine_v3_functions_and_units.sql` | `20261017180535` | Vérifiée |

MCP attribue ses propres horodatages de version ; les noms distants conservent le nom complet de chaque fichier source. Aucune réparation artificielle de l'historique n'a été faite. Les SHA256 normalisés des six sources correspondent au manifeste ; l'empreinte brute CRLF du script des quantités décimales est aussi conservée dans la preuve JSON.

## Contrôles exécutés

- Répétition locale native de l'ordre demandé sur un socle approchant le schéma partagé : prérequis achats **39/39**, achats décimaux **52/52**, contrat d'offre **107/107** ; M3 **178/178** unités et **198/198** moteur SQL. M2 : **11/12** ; M1 : gouvernance **210/210**, gardes **57/60**. Les quatre assertions restantes sont des écarts antérieurs détaillés ci-dessous, sans modification des assertions.
- Chaîne canonique locale complète : `npm run db:ci:local`, **17 fichiers, 1 714 assertions pgTAP PASS**, matrice RLS comportementale passée. Piles temporaires arrêtées et détruites.
- Sur la base partagée, après chaque application : corps des fonctions comparés aux sources, objets/contraintes/droits pertinents, historique de migration et empreintes des données d'origine. Chaque étape a été vérifiée avant la suivante.
- Contrôle final : **86 corps de fonction** attendus identiques aux sources finales, trois tables privées avec RLS et sans accès direct des rôles API ; les sept API d'achat authentifiées ont le `search_path` vide attendu et sont inaccessibles à `anon`.
- M2 : marquage initial conservé à NULL pour toutes les offres, contrainte valide, offre non marquée à 0 € refusée par le prédicat, « ML » / « ml » / « m » normalisés pour les achats.
- M1 : contrainte exacte {1,2,3}, trois gardes installées, aucune version 3 créée, prédicat de gouvernance et droits privés vérifiés.
- M3 : **12 unités**, alias « ML », « m.l. », « mètre linéaire » vers `ml`, « NC » vers le statut `not_priced`, référentiel en lecture seule pour `authenticated`, fonctions de calcul non appelables par les rôles API.
- Sonde SQL pure sur la base partagée : brut **1 000 c**, remise **101 c**, HT **899 c**, TVA **180 c**, TTC **1 079 c**. Aucune fixture insérée dans la base partagée.

## Préservation des données

Empreintes comparées à chaque étape sur **toutes les colonnes d'origine**, en excluant seulement les colonnes ajoutées par les six migrations. Nombre de lignes et empreinte de chaque table identiques avant/après :

| Table | Lignes contrôlées |
|---|---:|
| estimate_versions | 1 238 |
| estimate_items | 1 305 |
| estimate_templates | 0 |
| purchase_orders | 9 |
| purchase_order_items | 9 |
| estimate_emails | 0 |
| portal_tokens | 0 |
| estimate_documents | 51 |
| supplier_pricebook | 184 |

Aucun reçu, transfert historique ou historique d'édition inventé. Le contrôle initial trouvait zéro ligne d'achat liée à un devis et zéro email/jeton historique à classifier. Les devis, montants et documents existants sont conservés dans le périmètre de ces empreintes.

## Écarts antérieurs conservés

La répétition du socle partagé ne constitue pas une copie des données de production. Elle a identifié quatre assertions qui restent en échec sur ce socle :

1. Le calcul de prix de référence annule encore la moyenne positive en présence d'une offre à 0 € exclue. La fonction est strictement inchangée par les six scripts ; son empreinte normalisée en base partagée correspond à la répétition (`8e29fbcaf3a76b17359461c374f38e43`). La correction `20261011030647_reference_price_zero_and_inclusive_validity.sql` a été appliquée **uniquement à la pile locale jetable** pour une contre-épreuve : le test passe alors **12/12**. Elle n'a pas été appliquée à la base partagée.
2. La surcharge à 9 arguments `freeze_estimate_v2_document_snapshot` est absente avant comme après l'intervention.
3. La surcharge à 12 arguments `commit_generated_ouvrages` est absente avant comme après.
4. La surcharge à 8 arguments `finalize_estimate_assembly_calculation` est absente avant comme après.

Ces trois RPC absentes produisent `42883` dans les assertions concernées ; aucune assertion de garde n'a été assouplie. Leurs migrations et M4 ne font pas partie des six migrations autorisées. La réussite de la chaîne canonique ne qualifie pas ces fonctionnalités sur le schéma partagé incomplet.

## Conseillers de sécurité et incidents d'outil

| Catégorie | Avant | Après | Interprétation |
|---|---:|---:|---|
| Fonction SECURITY DEFINER exécutable par anon | 18 | 18 | Aucun nouvel accès anon de ce type |
| Fonction SECURITY DEFINER exécutable par authenticated | 40 | 47 | Sept API d'achat attendues ; corps, droits, contrôles acteur/tenant/projet et search_path vérifiés par les contrôles ciblés et spécialistes |
| RLS activée sans politique | 5 | 8 | Trois nouvelles tables privées fermées aux rôles API ; accès par les RPC autorisées |
| Protection des mots de passe divulgués | 1 | 1 | Avertissement antérieur conservé |

Sources des diagnostics : [fonctions accessibles aux utilisateurs connectés](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Ces diagnostics ne sont pas, seuls, des preuves d'exploitabilité.

La première application a été refusée par le contrôle automatique : validation jugée insuffisante. La chaîne canonique complète et les contre-épreuves ont été ajoutées, puis la même action a réussi avec le même outil. Plusieurs appels ont ensuite expiré avec `Invalid or expired requestState` ; chaque reprise a été précédée d'un contrôle du catalogue et de l'historique prouvant l'absence d'application. Aucun autre moyen d'écriture n'a été utilisé.

## Preuves et limites

- [Journal structuré complet](./shared-supabase-m2-m1-m3-application-2026-10-17.json) : autorisation, sources et hashes, commandes, résultats, requêtes de contrôle, états avant/après et historique.
- Journaux locaux : `.e2e/shared-migrations-20261017/`, notamment `local-report.json`, `local-psql.log`, `canonical-db-ci.log`, fichiers de régression, TAP et premières tentatives conservées.
- Aucun parcours UI de production, envoi réel ou PDF réel exécuté. Aucun déploiement. M4 reste hors périmètre.
- Les fichiers utilisateur préexistants et l'archive de passation sont préservés ; seuls les rapports d'intervention ont été ajoutés au dépôt.

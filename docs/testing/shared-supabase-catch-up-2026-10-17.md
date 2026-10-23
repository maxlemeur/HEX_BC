# Rattrapage du Supabase partagé — 17/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).


**14 migrations appliquées dans l'ordre autorisé, puis restauration de la définition récente écrasée. Aucun déploiement et aucune application de M4.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Sources immuables : `main` à `b91f938fa6e36db27a472cba095693553d1a41fe`, périmètre arrêté à M3. Les fichiers exacts ont été envoyés à `apply_migration` ; aucune utilisation de `supabase db push`.

## Application et historique distant

| Ordre | Fichier source | Version distante générée | Contrôle |
|---|---|---|---|
| 1 | `20260819230500_drop_product_tax_rate.sql` | `20261017182854` | Vérifiée |
| 2 | `20260906110121_supplier_price_validity_six_months.sql` | `20261017182902` | Vérifiée |
| 3 | `20261010010748_restore_service_role_catalogue_history_privileges.sql` | `20261017183003` | Vérifiée |
| 4 | `20261011030647_reference_price_zero_and_inclusive_validity.sql` | `20261017183009` | Vérifiée |
| 5 | `20261011080708_supplier_price_provenance_integrity.sql` | `20261017183013` | Vérifiée |
| 6 | `20261011221312_estimate_source_reference_review.sql` | `20261017183018` | Vérifiée |
| 7 | `20261011233527_estimate_source_coverage.sql` | `20261017183024` | Vérifiée |
| 8 | `20261012043643_atomic_generated_ouvrages.sql` | `20261017183029` | Vérifiée |
| 9 | `20261012215942_generated_ouvrage_component_decisions.sql` | `20261017183049` | Vérifiée |
| 10 | `20261013002038_assembly_library_component_provenance.sql` | `20261017183054` | Vérifiée |
| 11 | `20261013074536_finalize_estimate_assembly_calculation.sql` | `20261017183058` | Vérifiée |
| 12 | `20261013162417_estimate_v2_document_snapshot_session.sql` | `20261017183102` | Vérifiée |
| 13 | `20261013210744_estimate_manual_emission_session.sql` | `20261017183107` | Vérifiée |
| 14 | `20261013222533_estimate_email_reservation_session.sql` | `20261017183110` | Vérifiée |
| Restauration | `catalogue_products_page`, définition de M2 | `20261017183121` | Vérifiée |

La restauration porte le nom distant `shared_catchup_restore_latest_main_through_m3_20261017`. Son SQL exact, son SHA256 et sa provenance sont conservés dans le JSON. Les horodatages distants sont générés par MCP ; aucun identifiant historique n'a été réparé ni falsifié.

Avant application, le catalogue a été comparé aux objets et corps de fonctions attendus, puis à l'historique. Aucune des 14 n'était enregistrée sous son nom. Les effets de la migration 3 étaient déjà présents : huit droits CRUD de `service_role` sur les deux tables d'historique/validation. Aucun autre nom d'historique ne contenait son instruction de GRANT ; son application idempotente a tracé le contrat sans élargir les droits existants. Les autres migrations avaient des objets absents ou une définition ancienne. Les preuves sont fonction par fonction dans `catalogueAudit`.

## Répétition locale et définitions récentes

Deux piles natives locales possédées sous WSL, Node 24.14.0, Supabase CLI 2.120.0 / PostgreSQL 17.11 :

1. Construction du schéma canonique depuis les migrations du SHA source.
2. Construction du socle partagé sans les 14 migrations, avec reproduction **locale uniquement** des deux variantes de contraintes historiques de `estimate_items` décrites plus bas.
3. Comparaison avant rattrapage : **zéro différence** sur les fonctions présentes et les 24 tables existantes du périmètre.
4. Application des 14 fichiers exacts, dans l'ordre demandé ; vérification des corps de fonctions après chaque fichier.
5. Détection et restauration de la définition récente écrasée ; comparaison finale puis pgTAP.

Résultats :

- Répétition sur ce socle partagé : **17 fichiers pgTAP, 1 714 assertions réussies**.
- Chaîne canonique `npm run db:ci:local` : **1 714 assertions PASS**, matrice RLS comportementale passée.
- Arrêt et destruction des piles temporaires confirmés.
- Les quatre écarts fonctionnels signalés dans le rapport du matin sont résolus dans le périmètre : prix de référence, gel documentaire v2, écriture atomique d'ouvrages et finalisation des assemblages.

Une seule fonction a réellement régressé de version dans cette répétition : `public.catalogue_products_page`, recréée par la migration 1 dans son ancienne forme. Sa définition finale de `20261017093407_supplier_offer_zero_price_policy.sql` (M2) et ses droits canoniques ont été restaurés.

Les gardes d'émission/publication de M1, `estimate_offer_client_items_match` et les autres fonctions protégées sont restées identiques au contrôle initial **après chacune des 14 applications**. Elles n'ont pas été rejouées inutilement.

## Comparaison finale sur la base partagée

- **82 fonctions** : corps `prosrc` comparés par MD5 après normalisation LF, `proconfig` exacts, type de retour, volatilité, mode SECURITY DEFINER, STRICT, parallélisme et ACL identiques au schéma canonique.
- **33 tables** : colonnes, contraintes, index, déclencheurs, RLS et ACL comparés. **32 correspondent intégralement** ; `estimate_items` conserve uniquement les deux variantes historiques ci-dessous.
- Toutes les contraintes et tous les droits ajoutés ou modifiés par les 14 migrations correspondent à leurs sources canoniques.
- Les empreintes complètes des métadonnées comparées et les diagnostics détaillés sont conservés dans le JSON. L'ordre des clés JSON est neutralisé ; les listes d'objets et d'ACL sont triées avant comparaison.

## Données : effets prévus et conservation

Avant la suppression de `products.tax_rate_bp` : **1 304 produits et 1 304 valeurs non nulles**, une seule valeur distincte, **2 000 pb**. La colonne a été supprimée conformément à la migration 1. Les autres colonnes des produits sont inchangées.

La migration 2 a plafonné `valid_to` pour **141 des 184 offres**. Le digest des lignes complètes après transformation correspond exactement au digest calculé avant application pour cette transformation. Les autres champs, dont `updated_at`, sont inchangés.

**Effet d'historisation explicite :** le déclencheur existant `archive_supplier_pricebook_version` a généré **141 nouvelles lignes d'historique**, une par offre plafonnée. Ce sont des insertions automatiques de l'archivage existant, pas des fixtures ni des données de test. Elles sont conservées :

- chaque `previous_offer` correspond exactement à l'offre antérieure, avec la seule différence de `valid_to` attendue après plafonnement ;
- les **21 lignes d'historique préexistantes** gardent exactement leur empreinte d'origine ;
- les 141 lignes nouvelles portent `UPDATE` et couvrent 141 offres distinctes.

Le contrôle s'est arrêté sur cette augmentation, avant de poursuivre après vérification. Aucun historique n'a été supprimé et aucun déclencheur d'audit n'a été neutralisé.

Les empreintes des **lignes d'origine de 31 tables** restent identiques avant/après, en excluant uniquement la colonne supprimée et la date d'expiration volontairement transformée. Le journal antérieur est comparé séparément des ajouts automatiques. Cela couvre notamment devis, lignes, achats, documents, catalogue, DPGF, ouvrages, références sources et événements préexistants. Aucune fixture et aucune donnée de test n'ont été insérées dans la base partagée.

## Écarts restants, antérieurs et hors des 14 migrations

Sur `public.estimate_items`, les deux écarts suivants étaient présents **avant** le rattrapage et sont inchangés :

1. **Différence de règle** : `estimate_items_item_type_payload_check` n'exige pas encore, pour une section, les contrôles atelier/chantier supplémentaires du canonique : heures NULL, coefficients à 1 et rôles NULL.
2. **Différence de nom seulement** : `estimate_items_pu_ht_check` au lieu de `estimate_items_pu_ht_cents_check` ; le prédicat `pu_ht_cents IS NULL OR pu_ht_cents >= 0` est identique.

Le canonique provient des migrations historiques `028_est_032_h_mo_majoration_and_estimate_item_functions.sql`, `029_est_031_labor_split_atelier_chantier.sql` et `20260222001500_est164_catalog_suggestions.sql`. Aucune des 14 sources ne modifie ces deux contraintes ; aucune correction distante supplémentaire n'a été improvisée.

Ces variantes ont été reproduites dans la seconde répétition locale, qui réussit aussi **1 714/1 714**. Elles doivent être signalées au porteur de M4, notamment si son SQL nomme explicitement la contrainte de PU. Ce rapport ne qualifie pas l'application de M4.

## Conseillers de sécurité et limites

Après opération : 17 informations « RLS sans politique » (dont les tables privées fermées), 18 avertissements de fonctions SECURITY DEFINER accessibles à `anon` (**inchangé**), 61 accessibles à `authenticated` (47 avant ce rattrapage), et l'avertissement de protection des mots de passe divulgués préexistant.

Les nouvelles API authentifiées et les tables privées sont celles des migrations autorisées, avec les ACL et `search_path` canoniques comparés. Aucun diagnostic n'a été corrigé par suppression ou élargissement opportuniste de droits. Voir [RLS sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) et [fonctions accessibles aux utilisateurs connectés](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Les suites SQL/RLS locales et les contrôles de catalogue partagés ne constituent pas une recette UI de production, une émission réelle de PDF ou un envoi fournisseur. **M4, déploiement Vercel et données de test partagées restent exclus.**

## Preuves

- [Journal structuré de ce rattrapage](./shared-supabase-catch-up-2026-10-17.json).
- [Rapport du matin : prérequis, M2, M1 et M3](./shared-supabase-m2-m1-m3-application-2026-10-17.md).
- Journaux et snapshots détaillés locaux : `.e2e/shared-catch-up-20261017/`. Les empreintes de `full-remote-proof.json`, du harnais, du journal pgTAP et du journal canonique figurent dans le JSON.

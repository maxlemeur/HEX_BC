# Catalogue, fournisseurs et prix

> **Source : le code au 2026-07-29.** Chaque affirmation porte une référence `fichier:ligne`. En cas de divergence, le code fait foi et ce document doit être corrigé.

Périmètre : produits, fournisseurs, sites de livraison, types de fourniture, pricebook, indices matériaux, taux de change, barèmes de marge, imports de tarifs, fraîcheur des prix, suggestions de prix et présélection fournisseur. Les formules de marge, de coefficient global et d'arrondi ne sont pas reprises ici : voir [`../metier/regles-de-calcul.md`](../metier/regles-de-calcul.md).

---

## 1. Modèle de données

| Table | Rôle | Définition |
| --- | --- | --- |
| `products` | Catalogue produit interne (une ligne = un article) | `supabase/schema.sql:227-243` |
| `suppliers` | Fournisseurs | `supabase/schema.sql:183-199` |
| `delivery_sites` | Chantiers / sites de livraison | `supabase/schema.sql:207-219` |
| `supply_types` | Types de fourniture par tenant (`code`, `name`) | `supabase/migrations/027_draft_locks.sql:169-177` |
| `supplier_catalog_items` | Paire (fournisseur, produit) + référence fournisseur + URL catalogue | `supabase/migrations/20260714181641_add_supplier_catalog_items.sql:4-23` |
| `supplier_pricebook` | Prix fournisseur daté (fenêtre `valid_from`/`valid_to`, `min_quantity`) | `supabase/migrations/014_catalogue_pricebook_indices_s4.sql:3-23` |
| `material_indices` | Indices matière datés | `supabase/migrations/014_catalogue_pricebook_indices_s4.sql:42-56` |
| `dpgf_catalogue_links` | Liaison ligne DPGF importée → produit / prix / indice | `supabase/migrations/014_catalogue_pricebook_indices_s4.sql:73-86` |
| `currency_rates` | Taux de change par tenant | `supabase/migrations/20260224090000_est027_currency_rates.sql:3-19` |
| `margin_tiers` | Barème de marge par tranche de coût | `supabase/migrations/023_margin_tiers.sql:67-75` |

Toutes ces tables portent `tenant_id`. Pour `products`, `suppliers` et `delivery_sites`, la colonne a été ajoutée rétroactivement (`supabase/migrations/013_multitenant_core_s5.sql:207-211`), avec `default public.current_tenant_id()` (`:472-474`) et un trigger d'affectation (`:587-599`).

### Unicité

| Contrainte | Référence |
| --- | --- |
| `products (tenant_id, reference)` partiel `reference is not null` | `supabase/migrations/013_multitenant_core_s5.sql:777-779` |
| `delivery_sites (tenant_id, project_code)` partiel | `supabase/migrations/013_multitenant_core_s5.sql:773-775` |
| `supply_types (tenant_id, code)` | `supabase/migrations/027_draft_locks.sql:176` |
| `supplier_catalog_items (tenant_id, supplier_id, product_id)` | `supabase/migrations/20260714181641_add_supplier_catalog_items.sql:21-22` |
| `supplier_pricebook (tenant_id, supplier_catalog_item_id, currency, valid_from, min_quantity)` | `supabase/migrations/20260714181641_add_supplier_catalog_items.sql:179-186` |
| `material_indices (tenant_id, index_code, index_date)` | `supabase/migrations/014_catalogue_pricebook_indices_s4.sql:55` |
| `currency_rates (tenant_id, from_currency, to_currency, effective_date)` | `supabase/migrations/20260224090000_est027_currency_rates.sql:21-22` |
| `margin_tiers (tenant_id, threshold_cents)` et `(tenant_id, position)` | `supabase/migrations/023_margin_tiers.sql:77-80` |

Les unicités globales d'origine (`products.reference`, `delivery_sites.project_code`) ont été supprimées lors du passage multi-tenant (`supabase/migrations/013_multitenant_core_s5.sql:740-771`).

### Droits (RLS)

| Table | Lecture | Écriture |
| --- | --- | --- |
| `products`, `suppliers`, `delivery_sites` | membre du tenant | rôle `admin` uniquement (`supabase/migrations/013_multitenant_core_s5.sql:1106-1189`) |
| `supplier_pricebook`, `material_indices` | membre du tenant | `admin` ou `engineer` (`supabase/migrations/014_catalogue_pricebook_indices_s4.sql:141-165`) |
| `supplier_catalog_items` | membre du tenant (`SELECT` seul accordé à `authenticated`) | aucune écriture directe : `grant select, insert, update, delete … to service_role` (`supabase/migrations/20260714181641_add_supplier_catalog_items.sql:42-50`) |
| `margin_tiers` | membre du tenant | `admin` (`supabase/migrations/023_margin_tiers.sql:92-103`) |
| `currency_rates` | membre du tenant | `admin` (`supabase/migrations/20260224090000_est027_currency_rates.sql:63-74`) |
| `supply_types` | membre du tenant | membre du tenant (`supabase/migrations/027_draft_locks.sql:190-195`) |

Conséquence pratique : un `engineer` ne peut pas insérer un produit ou un fournisseur par la table, mais il le peut via les fonctions `security definer` `create_supplier_catalog_price` et `bulk_create_supplier_prices` (§5).

---

## 2. Produits

Colonnes métier : `reference`, `designation`, `unit_price_cents`, `tax_rate_bp` (défaut `2000`, borné `0..10000`), `unit` (défaut `'u'`), `is_active` (`supabase/schema.sql:227-243`). Les attributs de caractérisation (`category`, `product_type`, `material`, `grade`, `dimensions`, `standard`) ont été ajoutés par `supabase/migrations/20260710004237_extend_products_inox_attributes.sql:1-8`, avec index partiels sur `category` et `material` (`:10-16`). Le schéma d'écriture API accepte indifféremment `reference` ou l'alias historique `hex_code`, et en exige au moins un (`src/lib/catalogue/schemas.ts:152-161`) ; la lecture renormalise les deux vers la même valeur (`src/lib/catalogue/server.ts:671-684`). Recherche plein texte : `catalogue_normalize_search()` = `lower(unaccent(...))` (`supabase/migrations/20260712201900_catalogue_prices_server_pagination.sql:4-14`), avec index GIN trigram sur la concaténation des 8 champs (`:19-31`).

`supply_types` est alimenté par un jeu de valeurs par défaut posé à la migration pour tous les tenants — `tube`, `raccord`, `robinetterie`, `vanne`, `calorifuge`, `support`, `divers` (`supabase/migrations/027_draft_locks.sql:203-222`) — puis complété par un code dérivé des catégories de devis existantes (`:224-259`). `estimate_items.supply_type_id` référence la table (`:198`). `grep -rn "supply_types" src/app/api/ src/app/dashboard/` ne renvoie rien : il n'existe ni écran ni route API dédiés ; ils ne sont consommés que par l'éditeur de devis (`src/components/estimates/EstimateEditorTable.tsx:2434`).

---

## 3. Pricebook : identité fournisseur/produit séparée du prix

Depuis `20260714181641`, une offre fournisseur se décompose en deux niveaux : **`supplier_catalog_items`** porte ce qui ne varie pas dans le temps — `supplier_sku` (≤ 255 car.) et `product_url` (contraint `^https?://[^[:space:]]+$`, ≤ 2000 car.) (`supabase/migrations/20260714181641_add_supplier_catalog_items.sql:11-18`) — et **`supplier_pricebook`** porte les prix datés, chacun rattaché par `supplier_catalog_item_id` `not null` (`:155-168`).

Deux triggers verrouillent la structure : `set_supplier_catalog_item_scope` dérive le `tenant_id` du fournisseur et refuse un fournisseur et un produit de tenants différents (`:188-226`) ; `sync_supplier_price_catalog_item` retrouve ou exige l'article catalogue pour chaque ligne de prix, recale `tenant_id`/`supplier_id`/`product_id` depuis lui et recopie `supplier_sku` (`:228-268`), sans quoi : `A supplier catalogue item is required for every supplier price.` (`:250`). Le backfill a choisi un `supplier_sku` et une `product_url` par paire, l'URL étant extraite du préfixe `source: <url>` des `notes` historiques (`:132-153`) ; les `supplier_sku` des anciennes lignes de prix ne sont pas réécrits (`:70-72`).

**Meilleur prix d'un produit** : le prix actif le plus bas dont la fenêtre couvre `current_date`, départagé par `updated_at desc` puis `id asc` (`supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql:358-373`).

---

## 4. Fraîcheur des prix — deux échelles coexistent

C'est le point le plus susceptible d'induire en erreur : **deux définitions de « prix périmé » cohabitent, et elles ne servent pas les mêmes écrans.**

### 4.1 Échelle A — seuil unique, paramétrable par tenant

| Élément | Valeur | Référence |
| --- | --- | --- |
| Seuil par défaut | `90` jours | `src/lib/catalogue/stale-prices.ts:1` |
| Seuil maximum accepté | `3650` jours | `src/lib/catalogue/stale-prices.ts:2` |
| Surcharge | feature flag `STALE_PRICE_DAYS` | `src/lib/feature-flags.ts:317-323` |
| Test | âge **strictement supérieur** au seuil | `src/lib/catalogue/stale-prices.ts:38-40` |
| Date retenue | `updated_at` sinon `created_at` ; absente ⇒ non périmé | `src/lib/catalogue/stale-prices.ts:32-33` |

Une valeur de flag hors `]0, 3650]` ou non numérique retombe sur le défaut (`src/lib/catalogue/stale-prices.ts:4-24`).

Cette échelle est celle des **contrôles métier** : blocage d'envoi de devis (`src/lib/estimates/gating.ts:473-480`), risques takeoff (`src/lib/takeoff/server.ts:3779-3785`), badge `is_stale` des suggestions catalogue (`src/lib/estimates/server.ts:1165-1170`), historique d'anomalies (`src/lib/estimates/anomaly-history.ts:419-421`). Le seuil effectif est renvoyé au client sous `stale_price_days` (`src/lib/estimates/server.ts:7805`) et affiché tel quel (`src/components/estimates/EstimateSendGatingDialog.tsx:195-198`).

### 4.2 Échelle B — trois paliers 30/90 jours, codés en dur en SQL

| Palier | Condition | Référence |
| --- | --- | --- |
| `fresh` | âge ≤ 30 j | `supabase/migrations/20260714181718_expose_supplier_catalog_metadata.sql:73` |
| `aging` | 30 j < âge ≤ 90 j | `:74` |
| `stale` | âge > 90 j | `:75` |

Les mêmes bornes sont répétées dans `catalogue_products_page.price_status`, qui ajoute la valeur `none` quand aucun prix fournisseur n'existe (`supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql:345-350`), dans `supplier_prices_summary` (`supabase/migrations/20260712201900_catalogue_prices_server_pagination.sql:404-414`) et dans `catalogue_products_summary`, dont le compteur `stale_count` utilise seulement `> 90` (`:253-256`). Ces seuils ne sont pas paramétrables.

Cette échelle est celle des **écrans de référentiel** : filtres et badges de `/dashboard/products` (`src/app/dashboard/products/page.tsx:77-82`, `:118-142`) et de `/dashboard/prices` (`src/components/catalogue/PricesManager.tsx:29-32`, `src/components/catalogue/prices-manager/utils.tsx:32-59`, qui affiche l'âge en jours). Le mapping serveur ne conserve que `aging` et `stale`, toute autre valeur devenant `fresh` (`src/lib/catalogue/server.ts:1414-1417`).

Une troisième implémentation existe et n'est pas branchée : `priceFreshnessLevel()` (`src/lib/catalogue/stale-prices.ts:43-60`) réimplémente l'échelle B en TypeScript, mais `grep -rn "priceFreshnessLevel" --include=*.ts --include=*.tsx src/` ne renvoie que sa propre définition et `src/lib/catalogue/stale-prices.test.ts`. Les niveaux affichés viennent tous du SQL.

---

## 5. Prix de référence produit : synchronisation automatique par trigger

`products.unit_price_cents` est le prix de référence affiché partout. **Il est réécrit par la base sans action utilisateur** dès qu'un bon de commande d'achat change d'état.

### 5.1 Colonnes

`manual_reference_price_cents` conserve la dernière saisie humaine — `not null`, défaut `0`, `check >= 0` (`supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql:4-28`). `reference_price_source_order_id`, `_item_id` et `_date` tracent la provenance du prix automatique ; à `null`, le prix est réputé saisi manuellement (`:30-35`).

### 5.2 Bascule en override manuel

`track_manual_product_reference_price()` (`:45-80`) : à l'`INSERT`, `manual_reference_price_cents := unit_price_cents` (`:52-55`) ; à l'`UPDATE OF unit_price_cents`, si les **trois** colonnes de provenance sont inchangées, la modification est réputée humaine — `manual_reference_price_cents` prend la nouvelle valeur **et les trois colonnes de provenance repassent à `NULL`** (`:57-66`). Éditer le prix depuis l'écran produit détache donc le produit de la synchronisation, jusqu'au prochain achat confirmé.

### 5.3 Recalcul

`refresh_product_reference_prices(p_tenant_id, p_product_ids)` (`:82-147`) efface d'abord les trois colonnes de provenance (`:99-105`) — commentaire à l'appui (`:96-98`) : c'est ce qui permet au trigger précédent de distinguer un rafraîchissement d'un override, y compris quand la même ligne d'achat est corrigée après confirmation. Il sélectionne ensuite, par produit, le **dernier achat validé** : `distinct on (item.product_id)` trié par `order_date desc, updated_at desc, id desc, position desc, …` (`:112-134`), restreint à `purchase_orders.status in ('confirmed', 'received')` (`:126`) et au même tenant (`:124-125`). Il écrit enfin `unit_price_cents = coalesce(prix du dernier achat, manual_reference_price_cents)` (`:138`) et renseigne les trois colonnes de provenance (`:139-141`).

| Événement | Trigger | Référence |
| --- | --- | --- |
| `after insert on purchase_orders` | `refresh_reference_prices_after_order_insert` | `:178-180` |
| `after update of status, order_date on purchase_orders` | `refresh_reference_prices_after_order_update` | `:183-185` |
| `after insert / update of (product_id, unit_price_ht_cents, purchase_order_id, tenant_id) / delete on purchase_order_items` | `refresh_reference_prices_after_order_item_*` | `:230-244` |

La fonction déclenchée sort tôt si ni `status` ni `order_date` n'ont changé (`:158-163`). La migration exécute un backfill immédiat sur tous les tenants (`:246-261`). `refresh_product_reference_prices` est révoquée pour `public`/`anon` et accordée à `authenticated` (`:444`, `:447`).

**Restitution.** `catalogue_products_page` renvoie `reference_price_source_order_reference`, `reference_price_source_supplier_name` et `reference_price_source_date` (`:304-307`, `:337-341`), repris en `_referencePriceSource*` (`src/lib/catalogue/server.ts:849-864`). L'écran affiche `Saisie interne` ou `Dernier achat confirmé · <fournisseur> · <référence> · <date>` (`src/app/dashboard/products/page.tsx:102-112`) ; le formulaire avertit que modifier le montant le remplace par une saisie interne (`src/app/dashboard/products/ProductFormModal.tsx:392-396`).

---

## 6. Barèmes de marge (`margin_tiers`)

Une tranche = `threshold_cents` (`>= 0`) + `multiplier` (`0..100`) + `position` (`>= 0`) (`supabase/migrations/023_margin_tiers.sql:67-75`). La borne haute à 100 vient d'un garde-fou anti-débordement d'entier (`supabase/migrations/017_margin_multiplier_upper_bound_s1.sql:1-10`), répliquée côté zod (`src/lib/estimates/schemas.ts:850-854`).

### 6.1 Valeurs par défaut

La migration insère le même barème pour **tous les tenants existants** (`supabase/migrations/023_margin_tiers.sql:105-119`) :

| `threshold_cents` | Seuil de coût | `multiplier` | `position` |
| --- | --- | --- | --- |
| `0` | 0 € | `1.6` | `0` |
| `10 000 000` | 100 000 € | `1.45` | `1` |
| `100 000 000` | 1 000 000 € | `1.4` | `2` |

Le même triplet est codé en dur côté TypeScript dans `DEFAULT_MARGIN_TIERS` (`src/lib/estimates/margin-tiers.ts:9-13`).

### 6.2 Repli silencieux

`loadMarginTiersForTotals()` renvoie un tableau vide quand le tenant n'a pas de barème (`src/lib/estimates/margin-tiers-loader.ts:50-69`), sans repli. Le repli a lieu un cran plus bas : `resolveMarginMultiplier()` substitue `getMarginTiers()` — donc `DEFAULT_MARGIN_TIERS` — dès que la liste reçue est vide (`src/lib/estimates/margin-tiers.ts:46`). C'est le seul point de repli, ce qu'affirment explicitement `src/lib/estimate-calculations.ts:406-409` et `src/lib/estimates/calc-context.ts:143-149`. Sélection du palier : tranches normalisées et triées par seuil croissant puis position (`src/lib/estimates/margin-tiers.ts:19-36`), on retient la dernière dont le seuil est `<=` au coût (`:54-61`) ; liste vide après normalisation ⇒ multiplicateur `1` (`:48`). Hors brouillon, le mode de marge est forcé à `fixed` au rendu, pour qu'un devis transmis n'affiche pas le barème du jour (`src/lib/estimates/margin-tiers-loader.ts:30-36`, appelé en `src/app/dashboard/estimates/[versionId]/page.tsx:252-259`).

Voir [`../metier/regles-de-calcul.md`](../metier/regles-de-calcul.md) § 3 pour l'application du multiplicateur.

---

## 7. Indices matériaux

`material_indices` porte `index_code`, `label`, `index_date`, `index_value` (`numeric(14,6)`, `>= 0`), `unit` (défaut `'base_100'`), `source`, `metadata` jsonb (`supabase/migrations/014_catalogue_pricebook_indices_s4.sql:42-56`). Le schéma d'écriture accepte les alias `code`/`index_code`, `value`/`index_value`, `effective_date`/`index_date` et en exige un de chaque (`src/lib/catalogue/schemas.ts:421-463`) ; la lecture renormalise (`src/lib/catalogue/server.ts:701-725`) et une date manquante retombe sur le jour courant (`:1861`).

Le bulk passe par la RPC `bulk_upsert_material_indices` (`supabase/migrations/015_catalogue_helpers_s4.sql:64-123`), en `upsert` sur `(tenant_id, index_code, index_date)` ; maximum 5000 items par appel (`src/lib/catalogue/schemas.ts:537`). Si la fonction est absente, un `upsert` direct prend le relais et le mode renvoyé passe à `fallback-upsert` (`src/lib/catalogue/server.ts:1881-1915`).

**Application de l'indice** : elle n'a lieu que dans les suggestions catalogue de l'éditeur de devis. Quand un `dpgf_catalogue_links` relie le prix fournisseur à un indice de valeur strictement positive, le prix affiché devient `round(unit_price_cents * index_value / 100)` (`src/lib/estimates/server.ts:1126-1130`), exposé sous `adjusted_unit_price_cents` avec `has_material_index_adjustment`, `material_index_code` et `material_index_value` (`:1162`, `:1172-1174`). C'est cette valeur ajustée qui sert au classement `best_price` (`:1218-1223`) et au patch de présélection (`:1748`).

---

## 8. Taux de change

Devises supportées : `EUR`, `USD`, `GBP` — en base (`supabase/migrations/20260224090000_est027_currency_rates.sql:14-16`) comme côté serveur (`src/lib/currency-rates.ts:19`). `source` ∈ `manual | api` (`:20` ; SQL `:17`), `rate > 0` (`src/lib/currency-rates.ts:79` ; SQL `:18`), `from_currency <> to_currency` (SQL `:16`, revérifié en `src/lib/currency-rates.ts:359-361`). Un trigger normalise la casse des trois colonnes texte (`:30-41`). L'écriture est réservée aux administrateurs du tenant (`src/lib/currency-rates.ts:248-251`).

**Il n'existe aucune fonction de conversion.** Preuve : `grep -rniE "convert(currency|Amount|Cents)|currencyConver|applyExchangeRate" --include=*.ts --include=*.tsx --include=*.sql src/ supabase/ scripts/` renvoie une unique occurrence, et c'est un commentaire qui constate cette absence (`src/lib/estimates/supplier-preselection.ts:7`). Les seuls exports de `src/lib/currency-rates.ts` sont le contexte d'acteur et les quatre opérations CRUD (`:253`, `:293`, `:346`, `:400`, `:468`).

Conséquence assumée dans le code : un prix fournisseur libellé dans une autre devise que le devis n'est jamais préselectionné automatiquement. Le prédicat `isSupplierAlternativeCurrencyCompatible()` traite une devise absente comme compatible — données historiques — et toute autre devise comme incompatible (`src/lib/estimates/supplier-preselection.ts:18-25`). Il est partagé par le serveur (`src/lib/estimates/server.ts:1682-1686`, `:1701-1708`) et par le client (`src/components/estimates/hooks/useEstimateSupplierComparison.ts:186`, `src/components/estimates/SupplierComparisonPanel.tsx:198`). La ligne bascule alors en exception `currency_mismatch` (`src/lib/estimates/supplier-preselection.ts:78`).

---

## 9. Import CSV de price book

Parcours en 5 étapes — `Charger`, `Detection`, `Associer`, `Resoudre`, `Importer` (`src/components/catalogue/price-book-csv-import/utils.ts:23`). Seuls les fichiers `.csv` sont acceptés, sur l'extension (`src/components/catalogue/price-book-csv-import/utils.ts:34-36`, `src/components/catalogue/price-book-csv-import/usePriceBookCsvWorkflow.ts:201-204`). Le fichier est d'abord enregistré comme import canonique via `POST /api/imports` avant toute validation (`src/components/catalogue/price-book-csv-import/utils.ts:151-160`, appelé en `usePriceBookCsvWorkflow.ts:230-232`) ; sans `sourceImportId`, l'import est bloqué (`:277-280`, `:436-439`).

### 9.1 Détection de profil et mapping de colonnes

Deux profils : `generic` et `mm_bdc` (`src/lib/catalogue/csv-import.ts:19`). Le profil `mm_bdc` est retenu dès que **au moins 3** des 5 colonnes signature `ID`, `F1_nom`, `F1_prix`, `F1_ref`, `F1_URL` sont présentes (`:141`, `:680-689`).

Cinq champs cibles : `supplier_name`, `product_reference`, `product_designation`, `unit_price`, `currency` (`:10-15`). Le mapping automatique compare chaque en-tête normalisé (sans accents, alphanumérique, minuscule — `:216-221`) aux alias de chaque cible (`:154-210`) et score : égalité `120 + longueur`, inclusion `85 + longueur` (moins 10 si l'en-tête contient `total`), tous les mots de l'alias présents `70 + nombre de mots` (`:275-296`). Les candidats sont triés par score puis ordre d'apparition, une source et une cible ne servant qu'une fois (`:721-737`).

En profil `mm_bdc`, le mapping est complété par des défauts positionnels `F1_nom → supplier_name`, `ID → product_reference`, `F1_prix → unit_price`, plus `Devise → currency` (`:742-774`).

Mapping minimal exigé avant validation : `supplier_name` **et** `unit_price` **et** (`product_reference` ou `product_designation`) (`:776-782`).

### 9.2 Normalisation des lignes

En profil `mm_bdc`, une ligne source produit jusqu'à trois offres (`F1`, `F2`, `F3`) quand les alternatives sont activées, sinon `F1` seul (`:518-520`, `:535-562`) ; la désignation est la concaténation par ` - ` de `Materiau`, `Dimension`, `Caracteristique`, `Precision` (`:525-531`) et une ligne sans aucun prix est **ignorée** avec le code `NO_SUPPLIER_PRICE` (`:564-581`). Auto-remplissage du fournisseur : si l'ensemble du fichier ne contient qu'un seul nom de fournisseur distinct parmi les lignes ayant un prix, il est appliqué aux lignes qui n'en portent pas (`:460-500`, `:541-546`, `:609-614`) ; actif par défaut (`:809`). La devise est mise en majuscules, `EUR` par défaut (`:138`, `:245-248`).

### 9.3 Validation

| Paramètre | Valeur | Référence |
| --- | --- | --- |
| Lignes d'aperçu | `10` par défaut | `src/lib/catalogue/csv-import.ts:139` ; forcé à `10` par l'UI (`usePriceBookCsvWorkflow.ts:177`) |
| Taille de lot | `250` par défaut ; `200` depuis l'UI | `src/lib/catalogue/csv-import.ts:140` ; `usePriceBookCsvWorkflow.ts:178` |
| Rendu de la main entre lots | `setTimeout(…, 0)` | `src/lib/catalogue/csv-import.ts:298-302`, `:1037-1039` |

Codes d'anomalie (`:29-41`), chacun assorti d'un correctif suggéré (`:325-354`) : `SUPPLIER_REQUIRED`, `SUPPLIER_UNKNOWN`, `SUPPLIER_AMBIGUOUS`, `PRODUCT_REQUIRED`, `PRODUCT_UNKNOWN`, `PRODUCT_AMBIGUOUS`, `PRICE_REQUIRED`, `PRICE_INVALID`, `PRICE_NON_POSITIVE`, `DUPLICATE_CANDIDATE`, `ZOD_VALIDATION_ERROR`, `NO_SUPPLIER_PRICE`.

Résolution des identifiants : correspondance **exacte** après `trim().toLowerCase()` sur le nom de fournisseur, puis sur la référence produit, puis à défaut sur la désignation ; plusieurs correspondances ⇒ `ambiguous` (`:379-434`). Le dédoublonnage intra-fichier porte sur `supplier_id | product_id | currency | prix_en_centimes` ; un doublon part en ligne *ignorée*, pas en rejet (`:941-949`, `:999-1004`). Les lignes retenues sont revalidées par `bulkCreateSupplierPricesSchema` avant acceptation (`:970-983`). Le tableau des rejets est exportable en CSV `;` (`usePriceBookCsvWorkflow.ts:483-510`) et un modèle vierge est téléchargeable (`:512-524`).

### 9.4 Résolution assistée, création assistée, envoi

`POST /api/prices/import/resolve` : recherche `ilike` limitée à 10 candidats, score de similarité (égalité `1`, préfixe `0.9`, inclusion `0.8`, sinon recouvrement de mots — `src/lib/catalogue/server.ts:384-414`), filtre `> 0.2`, top 3 (`:1947-1949`, `:1998-2000`). Côté client, seul un meilleur score `>= 0.75` est appliqué automatiquement (`usePriceBookCsvWorkflow.ts:313`). `POST /api/prices/import/create-missing` : crée les fournisseurs et produits manquants après contrôle d'existence exacte (`src/lib/catalogue/server.ts:2050-2058`, `:2101-2112`) ; un produit créé ainsi reçoit `designation = reference`, `unit_price_cents = 0`, `tax_rate_bp = 2000` (`:2114-2122`). L'écriture passe par les tables `suppliers`/`products`, donc requiert le rôle `admin` (§1).

L'UI poste `action: "bulk-create-atomic"` avec `batch_size: 5000` (`usePriceBookCsvWorkflow.ts:452-455`, constante en `utils.ts:13`). Limites zod : `bulk-create` ≤ `5000` items, `bulk-create-atomic` ≤ `50000` items avec `batch_size` ≤ `5000` (`src/lib/catalogue/schemas.ts:390-405`). **`batch_size` n'est pas utilisé côté serveur** : `bulkCreateSupplierPricesAtomic` transmet la totalité des items en un seul appel RPC, délibérément, pour que métadonnées catalogue et prix soient annulés ensemble en cas d'échec (`src/lib/catalogue/server.ts:1699-1716`).

Les feature flags `PRICE_IMPORT_GUIDED_ASSISTANT`, `PRICE_IMPORT_BDC_PROFILE`, `PRICE_IMPORT_CREATE_ASSIST`, `PRICE_IMPORT_MULTI_SUPPLIER` sont déclarés (`src/lib/feature-flags.ts:43-53`) mais `grep -rn "PRICE_IMPORT_GUIDED_ASSISTANT\|PRICE_IMPORT_BDC_PROFILE\|PRICE_IMPORT_CREATE_ASSIST\|PRICE_IMPORT_MULTI_SUPPLIER" src/` hors `feature-flags.ts` et hors tests ne renvoie rien : aucun comportement n'y est conditionné.

---

## 10. Autres imports

**Modèle Excel « produits + tarifs ».**

Classeur `v1.0` téléchargeable en `/templates/hex-bc-produits-tarifs-v1.xlsx` (`src/lib/catalogue/product-price-template.ts:3-4`). Trois feuilles obligatoires — `Mode d'emploi`, `Produits`, `Tarifs fournisseurs` (`:6-8`) — dont les en-têtes doivent être **exactement** ceux attendus, dans l'ordre (`:10-35`, `:181-215`). La version est lue en cellule `B2` de la feuille d'instructions et doit valoir `1.0` (`:471-480`). Contrôles bloquants par ligne : référence et désignation obligatoires, collision de référence insensible à la casse, prix `>= 0` produit / `> 0` fournisseur, TVA `0..100`, devise sur 3 lettres, date `YYYY-MM-DD` obligatoire, quantité minimale `> 0`, doublon `(référence, fournisseur, devise, date, quantité)` (`:237-292`, `:334-421`).

Côté serveur : maximum `5000` lignes par feuille (`src/lib/catalogue/product-price-template-server.ts:10`, `:44-45`), refus global si une seule référence produit ou fournisseur est inconnue ou ambiguë (`:217-243`), produits existants mis à jour par `upsert` sur `id` (`:277-285`), nouveaux insérés (`:287-293`), tarifs créés via la RPC `bulk_create_supplier_prices` (`:340-342`). Taille de fichier plafonnée à 5 Mo côté UI (`src/components/products/ProductPriceTemplateImport.tsx:39`).

**Import CSV produits simple.** `src/components/products/ProductCsvImport.tsx` — plafond 5 Mo (`:18`), parseur maison avec détection de séparateur et alias d'en-têtes (`src/components/products/product-csv.ts:42`, `:186-198`).

---

## 11. Suggestions de prix et présélection fournisseur

`GET /api/estimates/[versionId]/suggest-prices?q=…`, `q` d'au moins 2 caractères (`src/app/api/estimates/[versionId]/suggest-prices/route.ts:11`). La recherche porte sur 8 champs produit plus le nom fournisseur et le `supplier_sku` (`src/lib/estimates/server.ts:7753-7800`). **Fournisseur préféré** : la valeur du feature flag `PREFERRED_SUPPLIER_ID` si elle a la forme d'un UUID, sinon le fournisseur le plus fréquent parmi les candidats du produit (`:965-992`). Trois alternatives au plus sont proposées, dédoublonnées sur `supplier_price_id` : `best_price` (prix ajusté le plus bas, départagé par la mise à jour la plus récente), `most_recent`, `preferred_supplier` (`:1218-1237`).

`coverage_status` (`:1592-1610`) : `no_price` si aucune alternative, `stale` si l'alternative sélectionnée est périmée, `ambiguous` si des prix existent sans sélection, sinon `covered`. `risk_flags` (`:1567-1589`) : `multiple_alternatives`, `selection_missing`, `selected_stale`, `selected_not_best_price`.

**Présélection automatique** — une proposition n'est émise que si la ligne n'a aucune sélection, qu'il existe exactement **une** alternative, qu'elle n'est pas périmée et que sa devise est compatible (`:1662-1689`). Seule raison possible : `single_clear_option` (`:1758`). Le patch écrit `unit_price_ht_cents = adjusted_unit_price_cents` et `selected_supplier_price_id` (`:1747-1750`). Sinon la ligne devient une exception : `no_price`, `currency_mismatch`, `stale`, `divergence` ou `ambiguous`, dans cet ordre de priorité (`:1691-1723`).

`estimate_items.selected_supplier_price_id` référence `supplier_pricebook(id)` en `on delete set null` (`supabase/migrations/20260222001500_est164_catalog_suggestions.sql:508-518`), et doit rester `null` sur les sections (`:548`). L'URL catalogue affichée vient de `supplier_catalog_items.product_url`, à défaut de la première URL `http(s)` trouvée dans les `notes` du prix (`src/lib/estimates/server.ts:1175`, `:3549-3554`).

---

## 12. Scraper Sofinther

`scripts/sofinther-prices.ts`, lancé par `npm run prices:sofinther` (`package.json:35`). Playwright/Chromium, headless sauf `--headed` (`:389`). Défauts : `--base-url https://www.sofinther.fr/sof/` (`:32`), `--credentials docs/sofinther-credentials.local.md` (`:33`), `--output tmp/sofinther-prices.csv` (`:34`), `--timeout-ms 30000` — forcé à `30000` si `< 5000` ou non fini (`:45`, `:87-89`). `--refs` / `--input` n'ont pas de défaut : l'absence de référence est fatale (`:60-65`, `:381-383`).

Les identifiants sont lus dans `SOFINTHER_EMAIL` / `SOFINTHER_PASSWORD` en priorité, sinon extraits du fichier de credentials (`:117-139`). Le nom de fournisseur écrit est constant : `Sofinther` (`:35`). Chaque référence produit une ligne de statut `ok`, `not_found` ou `error` (`:28`, `:318-375`). Sortie CSV à séparateur `;`, 9 colonnes : `supplier_name`, `product_reference`, `product_designation`, `unit_price`, `currency`, `source_url`, `scraped_at`, `status`, `notes` (`:244-261`). Point de raccord avec §9 : parmi ces 9 colonnes, `source_url`, `scraped_at`, `status` et `notes` ne correspondent à aucun alias de `TARGET_FIELD_ALIASES` (`src/lib/catalogue/csv-import.ts:154-210`) ; elles ne sont donc pas mappées automatiquement à l'import.

---

## 13. Routes API

| Route | Méthodes | Contenu | Fichier |
| --- | --- | --- | --- |
| `/api/catalogue` | `GET`, `POST` | `GET` : liste (défaut 100, max 500) ou `?view=page` paginée ; `POST` : `create`, `update`, `delete`, `link-mapped-rows` | `src/app/api/catalogue/route.ts:46`, `:80` |
| `/api/catalogue/template-import` | `POST` | Import du classeur produits + tarifs | `src/app/api/catalogue/template-import/route.ts:7` |
| `/api/prices` | `GET`, `POST` | `GET` : liste (défaut 200, max 1000), `?view=page`, `?view=supplier-item` ; `POST` : `create`, `update`, `delete`, `update-supplier-item`, `bulk-create`, `bulk-create-atomic` | `src/app/api/prices/route.ts:40`, `:84` |
| `/api/prices/lookups` | `GET` | Options fournisseur/produit, max 50 | `src/app/api/prices/lookups/route.ts:10` |
| `/api/prices/import/resolve` | `POST` | Suggestions de résolution des inconnus | `src/app/api/prices/import/resolve/route.ts:17` |
| `/api/prices/import/create-missing` | `POST` | Création assistée fournisseurs/produits | `src/app/api/prices/import/create-missing/route.ts:17` |
| `/api/indices` | `GET`, `POST` | `POST` : `create`, `update`, `delete`, `bulk-upsert` | `src/app/api/indices/route.ts:31`, `:47` |
| `/api/currency-rates` | `GET`, `POST` | Liste filtrable, création | `src/app/api/currency-rates/route.ts:48`, `:72` |
| `/api/currency-rates/[rateId]` | `PATCH`, `DELETE` | | `src/app/api/currency-rates/[rateId]/route.ts:63`, `:93` |
| `/api/margin-tiers` | `POST` | Création de tranche | `src/app/api/margin-tiers/route.ts:13` |
| `/api/margin-tiers/[tierId]` | `PATCH`, `DELETE` | | `src/app/api/margin-tiers/[tierId]/route.ts:24`, `:38` |
| `/api/estimates/[versionId]/suggest-prices` | `GET` | Suggestions catalogue pour une ligne | `src/app/api/estimates/[versionId]/suggest-prices/route.ts:32` |

Pagination : tailles `25 | 50 | 100` uniquement (`src/lib/catalogue/schemas.ts:103`), plafonnées à 100 côté SQL (`supabase/migrations/20260712201900_catalogue_prices_server_pagination.sql:213-214`). Quand une page au-delà de la première revient vide, un second appel en page 1 récupère le total (`src/lib/catalogue/server.ts:814-827`, `:1387-1400`).

---

## 14. Fonctions SQL

| Fonction | Rôle | Référence |
| --- | --- | --- |
| `catalogue_normalize_search(text)` | `lower(unaccent(...))`, `immutable` | `20260712201900:4-14` |
| `catalogue_products_page(...)` | Page catalogue enrichie (meilleur prix, `price_status`, provenance du prix de référence) | `20260714090000:276-442` |
| `catalogue_products_summary()` | Compteurs et facettes matière/catégorie/unité | `20260712201900:217-261` |
| `supplier_prices_page(...)` | Page pricebook + métadonnées `supplier_catalog_items` | `20260714181718:6-138` |
| `supplier_prices_summary(...)` | Compteurs `fresh`/`aging`/`stale`/fournisseurs distincts | `20260712201900:388-415` |
| `price_lookup_options(...)` | Options fournisseur/produit, max 50 | `20260712201900:417-470` |
| `create_supplier_catalog_price(jsonb)` | Création atomique fournisseur + produit + article + prix, `security definer`, `admin`/`engineer` | `20260714181702:3-200` |
| `update_supplier_catalog_item(uuid, text, text)` | MAJ SKU/URL, `security definer` | `20260714181702:205-254` |
| `bulk_create_supplier_prices(jsonb, uuid)` | Import de masse, `security definer`, contrôle de rôle et des sources d'import | `20260714181641:272-425` |
| `bulk_upsert_material_indices(jsonb, uuid)` | Upsert d'indices | `015:64-123` |
| `link_mapped_rows_to_catalogue(jsonb, uuid)` | Rattachement lignes DPGF ↔ catalogue | `015:125-178` |
| `refresh_product_reference_prices(uuid, uuid[])` | Recalcul du prix de référence (§5) | `20260714090000:82-147` |

Les fonctions de page sont `security invoker` : l'isolation par tenant repose entièrement sur la RLS des tables sous-jacentes. Toutes sont révoquées pour `public`/`anon` et accordées à `authenticated` (`20260712201900:472-482`, `20260714090000:444-448`, `20260714181718:139-145`).

Erreurs métier spécifiques remontées par les RPC : `SUPPLIER_CATALOG_REFERENCE_CONFLICT` et `SUPPLIER_CATALOG_URL_CONFLICT` quand un article catalogue existant porte déjà une valeur différente (`20260714181702:151-161`, `20260714181641:370-380`).

---

## 15. Écrans

| Chemin | Contenu | Fichier |
| --- | --- | --- |
| `/dashboard/referentiel` | Hub : Fournisseurs, Chantiers, Produits, Ouvrages | `src/app/dashboard/referentiel/page.tsx:5-40` |
| `/dashboard/tarifs` | Hub : Prix fournisseurs, Indices | `src/app/dashboard/tarifs/page.tsx:3-26` |
| `/dashboard/products` | Table produits paginée, facettes, badges de fraîcheur, imports CSV et modèle | `src/app/dashboard/products/page.tsx` (1025 lignes) |
| `/dashboard/suppliers` | CRUD fournisseurs | `src/app/dashboard/suppliers/page.tsx` (862 lignes) |
| `/dashboard/sites` | CRUD sites de livraison | `src/app/dashboard/sites/page.tsx` (771 lignes) |
| `/dashboard/prices` | Pricebook + import CSV + panneau JSON bulk | `src/app/dashboard/prices/page.tsx:12-16`, `src/components/catalogue/PricesManager.tsx` |
| `/dashboard/catalogue` | Articles + liaison des lignes DPGF importées | `src/app/dashboard/catalogue/page.tsx:5-19`, `src/components/catalogue/CatalogueManager.tsx` |
| `/dashboard/indices` | CRUD indices + bulk upsert | `src/app/dashboard/indices/page.tsx:4-17`, `src/components/catalogue/IndicesManager.tsx` |

Le panneau JSON de `/dashboard/prices` poste directement `action: "bulk-create"` (`src/components/catalogue/prices-manager/BulkJsonPanel.tsx:51`) ; celui des indices poste `action: "bulk-upsert"` (`src/components/catalogue/IndicesManager.tsx:243`).

**Voir aussi** : [`../metier/regles-de-calcul.md`](../metier/regles-de-calcul.md) — marge, marque, coefficient global, arrondis, TVA.

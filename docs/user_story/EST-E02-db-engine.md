# EST-E02 — DB Engine (calculs, contraintes)

> Milestone: M0 | Priorite: P0 | Statut: A faire

## Objectif

Garantir l'exactitude des calculs de chiffrage, ajouter les modes de remise avances
(cascade), supporter le multi-devises et enforcer les invariants de coherence au niveau
de la base de donnees. Cette epic renforce le moteur de calcul qui est au coeur
de la fiabilite du module.

## Ce qui existe deja

Les sprints BC-004 et BC-005 ont livre le moteur de calcul suivant :

- **Moteur de calcul ligne** : `src/lib/estimate-calculations.ts` —
  `computeEstimateLineValues()` calcule FO (fourniture = `quantity * unit_price * k_fo`),
  MO (main d'oeuvre = `h_mo * hourly_rate * k_mo`), prix unitaire HT
  (`pu_ht = fo + mo`), applique le coefficient de marge (`margin_multiplier`),
  puis calcule HT/TVA/TTC par ligne
- **Moteur de calcul totaux** : `computeEstimateTotals()` avec strategie Attic+
  (TVA calculee par ligne puis sommee), application de la remise (`discount_bp`),
  modes d'arrondi (`RoundingMode`: none, nearest, up, down), pas d'arrondi
  configurable (`rounding_step_cents`)
- **Fonctions utilitaires** :
  - `normalizeDraftItems()` — normalise les items bruts pour le calcul
  - `computeInitialDiscountCents()` — calcul de la remise avant arrondi
  - `computeStoredDiscountCents()` — calcul de la remise stockee
  - `computeReadOnlyTotals()` — recalcul des totaux en lecture seule
- **Gardes de debordement** : `MAX_MARGIN_MULTIPLIER` (100), `MAX_CENTS` (2^31 - 1)
- **Types** : `EstimateLineLike`, `EstimateLineValues`, `EstimateTotals`,
  `RoundingMode`, `EstimateItemRecord`, `EstimateVersionForCalc`
- **RPCs atomiques** :
  - `bulk_update_estimate_items(...)` — mise a jour groupee avec snapshot audit
  - `reorder_estimate_items(...)` — reordonnancement atomique
- **Utilitaires monetaires** : `src/lib/money.ts` — `formatEUR()`,
  `parseEuroToCents()`, `bankersRound()`, `computeTaxCents()`
- **Tests unitaires** : `estimate-calculations.test.ts` via Vitest, couverture
  des cas limites (arrondi, overflow, remise 0%, marge 1x a 100x)

---

## EST-025 — Double discount (remise en cascade)

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que chiffreur, je veux appliquer une remise en cascade (par exemple : -10%
> puis -5% supplementaire), afin de gerer les negociations complexes avec plusieurs
> niveaux de reduction.

### Criteres d'acceptation

- [ ] Nouvelle colonne `discount_mode` sur `estimate_versions` :
      type enum `'simple' | 'cascade'`, defaut `'simple'`
- [ ] Nouvelle colonne `discount_steps` sur `estimate_versions` :
      type `integer[]` (tableau de basis points), defaut `'{}'`
- [ ] En mode `simple` : comportement inchange, `discount_bp` unique
- [ ] En mode `cascade` : chaque etape s'applique sur le sous-total restant
      (ex: 10000 - 10% = 9000, puis 9000 - 5% = 8550)
- [ ] `computeEstimateTotals()` modifie pour supporter le mode cascade :
      boucle sur `discount_steps`, application sequentielle avec
      `bankersRound()` a chaque etape
- [ ] Schema Zod `patchEstimateVersionSchema` etendu pour valider
      `discount_mode` et `discount_steps` (chaque step entre 0 et 10000 bp)
- [ ] UI dans `EstimateSettingsPanel.tsx` : toggle simple/cascade,
      ajout/suppression d'etapes de remise, affichage du total apres
      chaque etape
- [ ] Tests unitaires : cascade vide (= pas de remise), cascade 1 etape
      (= identique a simple), cascade multi-etapes, valeurs limites
- [ ] Mode "coefficient global" (ex: 1.30 OPTIMA) : colonne `global_coefficient` (numeric, default 1.0) sur `estimate_versions`, applique apres marge, avant remise
- [ ] L'import OPTIMA (EST-034) mappe le coefficient global a ce champ
- [ ] UI dans `EstimateSettingsPanel.tsx` : champ numerique "Coefficient global" editable, visible uniquement en mode cascade

### Notes techniques

- Fichiers a modifier :
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()`,
    ajouter `computeCascadeDiscountCents(totalHtCents, steps[])`
  - `src/lib/estimates/schemas.ts` — `patchEstimateVersionSchema`
  - `src/components/estimates/EstimateSettingsPanel.tsx` — UI cascade
  - `src/lib/estimates/server.ts` — `patchEstimateVersion()` pour
    persister les nouvelles colonnes
- Fichiers a creer :
  - `supabase/migrations/022_discount_cascade.sql` (ou numero suivant)
- Reutiliser :
  - `src/lib/money.ts` — `bankersRound()` pour chaque etape
  - `src/lib/estimate-calculations.ts` — `computeStoredDiscountCents()`
    comme point de depart
  - Types existants `EstimateVersionForCalc`, `EstimateTotals`
- Dependances : EST-034 (import OPTIMA mappe le coefficient global)

---

## EST-026 — Rounding invariant enforcement

**Priorite:** P1 | **Effort:** S

### User Story

> En tant qu'admin, je veux que les invariants d'arrondi soient verifies au niveau
> de la base de donnees (par exemple : `total_ttc_cents >= total_ht_cents`),
> afin de prevenir les incoherences de calcul qui pourraient fausser les devis.

### Criteres d'acceptation

- [ ] Contrainte CHECK sur `estimate_versions` :
      `total_ttc_cents >= total_ht_cents` (quand les deux sont non null)
- [ ] Contrainte CHECK sur `estimate_versions` :
      `total_tax_cents >= 0`
- [ ] Contrainte CHECK sur `estimate_versions` :
      `total_ttc_cents = total_ht_cents + total_tax_cents` (coherence somme)
- [ ] Contrainte CHECK sur `estimate_items` (lignes) :
      `line_total_ttc_cents >= line_total_ht_cents` (quand non null)
- [ ] Validation server-side dans `patchEstimateVersion()` de `server.ts` :
      verifier les invariants avant ecriture, retourner `badRequest()`
      avec message explicite en cas de violation
- [ ] En cas de violation detectee cote serveur, log dans `audit_logs`
      avec action `'invariant_violation'` pour tracabilite
- [ ] Tests unitaires : scenario normal (OK), scenario avec totaux incoherents
      (rejet), scenario avec valeurs null (accepte)

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/023_rounding_invariants.sql` (ou numero suivant)
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — `patchEstimateVersion()`, ajouter
    validation pre-ecriture des invariants
  - `src/lib/estimates/errors.ts` — eventuellement nouveau code
    `INVARIANT_VIOLATION` si distinct de `BAD_REQUEST`
- Reutiliser :
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()` pour
    le recalcul de verification
  - `src/lib/estimates/errors.ts` — `badRequest()`, `toErrorResponse()`
  - Trigger existant `log_estimate_audit()` pour l'audit
- Dependances : aucune

---

## EST-027 — Multi-currency support

**Priorite:** P2 | **Effort:** L | **Milestone:** M3

### User Story

> En tant que chiffreur, je veux creer des devis dans differentes devises
> (EUR, USD, GBP), afin de repondre a des appels d'offres internationaux
> et de travailler avec des clients et fournisseurs etrangers.

> **Note PRD:** Reporte de M0 a M3 — tous les documents PRD reels (devis vierge, BDC, DPGF, OPTIMA) sont exclusivement en EUR.

### Criteres d'acceptation

- [ ] La colonne `currency` de `estimate_versions` (deja existante) est utilisee
      comme reference pour le formatage et l'affichage
- [ ] Nouvelle table `currency_rates` : `from_currency`, `to_currency`, `rate`
      (decimal), `effective_date`, `source` (manual/api), `tenant_id`
- [ ] `formatEUR()` de `money.ts` generalise en `formatCurrency(cents, currency)` :
      supporte EUR, USD, GBP avec symboles et separateurs corrects
      (ex: 1 234,56 EUR vs $1,234.56)
- [ ] Selecteur de devise dans `EstimateSettingsPanel.tsx` :
      dropdown avec devises disponibles, mise a jour du champ `currency`
- [ ] Affichage coherent dans l'editeur (`EstimateEditorTable.tsx`),
      la page de liste (`estimates/page.tsx`) et l'impression
      (`print/page.tsx`) — la devise du devis est respectee partout
- [ ] Endpoint API ou page admin pour gerer les taux de change
      (CRUD sur `currency_rates`)
- [ ] Les calculs restent en centimes de la devise choisie — pas de
      conversion automatique entre devises
- [ ] Tests unitaires : formatage EUR/USD/GBP, `parseEuroToCents()`
      adapte en `parseCurrencyToCents()`, edge cases (symboles, decimales)

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/024_currency_rates.sql` (ou numero suivant)
  - `src/app/api/currency-rates/route.ts` (CRUD admin)
  - `src/app/dashboard/admin/currencies/page.tsx` (optionnel)
- Fichiers a modifier :
  - `src/lib/money.ts` — renommer/etendre `formatEUR()` en
    `formatCurrency()`, adapter `parseEuroToCents()` en
    `parseCurrencyToCents()`, garder les anciennes fonctions comme alias
    pour retro-compatibilite
  - `src/components/estimates/EstimateSettingsPanel.tsx` — selecteur devise
  - `src/components/estimates/EstimateEditorTable.tsx` — affichage devise
  - `src/app/dashboard/estimates/[versionId]/print/page.tsx` — formatage devise
  - `src/app/dashboard/estimates/page.tsx` — colonne devise dans la liste
- Reutiliser :
  - `src/lib/money.ts` — `bankersRound()` (independant de la devise)
  - `src/lib/estimate-calculations.ts` — aucune modification directe
    (les calculs manipulent des centimes abstraits)
  - `src/lib/estimates/schemas.ts` — validation du champ `currency`
- Dependances : EST-006 (feature flag pour activer le multi-devises progressivement)

---

## EST-028 — Marge par tranches de valeur projet

**Priorite:** P1 | **Effort:** M | **Milestone:** M0

### User Story

> En tant que chiffreur, je veux que le coefficient de marge s'ajuste automatiquement selon les tranches de valeur du projet, afin d'appliquer la politique commerciale standard.

> **Origine PRD:** `devis_vierge_v1.xlsx` — tranches reelles : <100k EUR → 1.6, <1M EUR → 1.45, >1M EUR → 1.4.

### Criteres d'acceptation

- [ ] Nouvelle table `margin_tiers` : `id`, `tenant_id`, `threshold_cents` (bigint), `multiplier` (numeric), `position` (integer)
- [ ] RLS sur `margin_tiers` : lecture/ecriture scope tenant
- [ ] Toggle dans `EstimateSettingsPanel` : "Marge fixe" vs "Marge par tranche"
- [ ] En mode "Marge par tranche", le selecteur affiche les tranches configurees pour le tenant avec les coefficients associes
- [ ] `computeEstimateTotals()` en 2 passes : 1) somme des couts bruts → determination de la tranche, 2) application du coefficient de la tranche correspondante
- [ ] Le coefficient applique est stocke dans `margin_multiplier` (champ existant) pour tracabilite
- [ ] Migration avec jeu de tranches par defaut : `[0, 1.6], [10000000, 1.45], [100000000, 1.4]` (en cents)
- [ ] Tests unitaires : tranche basse, tranche moyenne, tranche haute, valeur exactement sur un seuil, devis vide

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/0xx_margin_tiers.sql` — table `margin_tiers` avec index et RLS
  - `src/lib/estimates/margin-tiers.ts` — fonctions `getMarginTiers()`, `resolveMarginMultiplier(totalCostCents, tiers[])`
- Fichiers a modifier :
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()`, ajouter le mode 2 passes avec appel a `resolveMarginMultiplier()`
  - `src/lib/estimates/schemas.ts` — `patchEstimateVersionSchema`, ajouter `margin_mode: 'fixed' | 'tiered'`
  - `src/components/estimates/EstimateSettingsPanel.tsx` — toggle marge fixe/tranches, affichage des tranches
- Reutiliser :
  - `src/lib/estimate-calculations.ts` — `computeEstimateLineValues()` pour la premiere passe (somme des couts)
  - `src/lib/money.ts` — `bankersRound()`, `formatEUR()`
- Dependances : aucune

---

## EST-029 — Classification Type FO (type de fourniture)

**Priorite:** P2 | **Effort:** S | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux classifier chaque ligne par type de fourniture (tube, raccord, robinetterie, calorifuge...), afin de regrouper les couts par famille d'achat.

> **Origine PRD:** `explication BDC V1.1.docx` — colonne "Type FO" presente dans les 31 colonnes du BDC.

### Criteres d'acceptation

- [ ] Nouvelle table `supply_types` : `id`, `tenant_id`, `code` (text, unique par tenant), `name` (text)
- [ ] RLS sur `supply_types` : lecture/ecriture scope tenant
- [ ] Nouvelle colonne `supply_type_id` (FK nullable) sur `estimate_items`
- [ ] Dropdown filtrable dans la colonne "Type FO" de l'editeur
- [ ] Le type FO est inclus dans les exports DPGF et BDC (EST-202)
- [ ] Regroupement par type FO disponible dans les sous-totaux section (EST-121)
- [ ] Migration avec types par defaut : tube, raccord, robinetterie, vanne, calorifuge, support, divers

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/0xx_supply_types.sql` — table `supply_types` + FK sur `estimate_items`
- Fichiers a modifier :
  - `src/components/estimates/EstimateEditorTable.tsx` — colonne "Type FO" avec dropdown filtrable
  - `src/lib/estimates/schemas.ts` — ajouter `supply_type_id` aux schemas de validation
- Reutiliser :
  - Pattern des `estimate_categories` existant pour le CRUD et le dropdown
- Dependances : aucune

---

## EST-031 — Split MO Atelier / Chantier

**Priorite:** P1 | **Effort:** M | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux distinguer le temps MO atelier et chantier par ligne, afin de repondre aux DPGF clients qui separent ces deux postes.

> **Origine PRD:** `HEX-DPGF-COLT-PAR2-LOT4.xlsx` — colonnes separees pour quantite et taux MO atelier vs chantier.

### Criteres d'acceptation

- [ ] Nouvelles colonnes sur `estimate_items` : `h_mo_atelier` (numeric), `k_mo_atelier` (numeric, default 1.0), `labor_role_atelier_id` (FK nullable), `h_mo_chantier` (numeric), `k_mo_chantier` (numeric, default 1.0), `labor_role_chantier_id` (FK nullable)
- [ ] Feature flag (EST-006) controle l'activation : desactive = comportement actuel (colonnes `h_mo` et `k_mo` standard), active = colonnes split atelier/chantier
- [ ] Calcul MO split : `MO = (h_atelier * rate_atelier * k_atelier) + (h_chantier * rate_chantier * k_chantier)`
- [ ] L'editeur affiche 2 groupes de colonnes MO quand le split est actif
- [ ] La vue impression separe les totaux MO atelier et MO chantier
- [ ] L'export DPGF (EST-202) inclut les colonnes split si actif
- [ ] Retrocompatibilite : si le split est desactive, `h_mo` et `k_mo` existants sont utilises sans changement
- [ ] Tests unitaires : split actif avec les deux MO, split actif avec un seul MO, split desactive

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/0xx_labor_split.sql` — colonnes split sur `estimate_items`
- Fichiers a modifier :
  - `src/lib/estimate-calculations.ts` — `computeEstimateLineValues()`, ajouter branche de calcul split MO (lignes ~84-86)
  - `src/components/estimates/EstimateEditorTable.tsx` — colonnes atelier/chantier conditionnelles
  - `src/lib/estimates/schemas.ts` — ajouter les champs split aux schemas
  - `src/app/dashboard/estimates/[versionId]/print/page.tsx` — sous-totaux MO atelier/chantier
- Reutiliser :
  - `src/lib/estimate-calculations.ts` — pattern existant de calcul MO
  - `src/lib/estimates/schemas.ts` — pattern existant pour les FK labor_role
- Dependances : EST-006 (feature flags)

---

## EST-032 — Coefficient de majoration temps de pose

**Priorite:** P2 | **Effort:** S | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux appliquer un coefficient de majoration au temps de pose, afin de prendre en compte les conditions reelles du chantier.

> **Origine PRD:** `OPTIMA Hydraulique/Plomberie` — colonne "Majoration MO" presente sur chaque ligne, appliquee au temps de pose.

### Criteres d'acceptation

- [ ] Nouvelle colonne `h_mo_majoration` (numeric, default 1.0) sur `estimate_items`
- [ ] Calcul : `h_mo_effectif = h_mo * h_mo_majoration` — le temps effectif remplace `h_mo` dans tous les calculs MO
- [ ] Editable par ligne dans l'editeur (affichage en pourcentage : 1.0 = 100%, 1.15 = 115%)
- [ ] Action bulk sur selection : appliquer un coefficient de majoration a toutes les lignes selectionnees
- [ ] La majoration est incluse dans l'export DPGF et BDC
- [ ] L'import OPTIMA (EST-034) mappe la colonne "Majoration MO" a ce champ
- [ ] Tests unitaires : majoration 1.0 (neutre), majoration > 1 (augmentation), majoration < 1 (reduction)

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/0xx_labor_majoration.sql` — colonne `h_mo_majoration` sur `estimate_items`
- Fichiers a modifier :
  - `src/lib/estimate-calculations.ts` — `computeEstimateLineValues()` (lignes ~84-86), remplacer `h_mo` par `h_mo * h_mo_majoration` dans le calcul MO
  - `src/lib/estimates/schemas.ts` — ajouter `h_mo_majoration` aux schemas
  - `src/components/estimates/EstimateEditorTable.tsx` — colonne "Majoration" editable
- Reutiliser :
  - Pattern des colonnes editables existantes dans `EstimateEditorTable`
  - `bulkUpdateEstimateItems()` pour l'action groupee
- Dependances : aucune

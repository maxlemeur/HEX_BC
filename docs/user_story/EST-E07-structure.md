# EST-E07 — Structure (chapitres/lignes)

> Milestone: M1 | Priorite: P1 | Statut: A faire

## Objectif

Enrichir la hierarchie sections/lignes avec des sous-totaux automatiques, des operations au niveau section, la conversion entre types d'items et une numerotation automatique. L'objectif est de permettre au chiffreur de structurer finement ses devis complexes avec plusieurs niveaux de lots.

## Ce qui existe deja

- **Schema DB** : table `estimate_items` avec `parent_id` pour la hierarchie, `item_type` ('section' | 'line'), `position` pour l'ordre d'affichage.
- **Tableau editeur** : `src/components/estimates/EstimateEditorTable.tsx` — rendu arborescent avec sections comme groupes depliables, drag-and-drop via dnd-kit pour le reordonnancement.
- **Fonction DB** : `reorder_estimate_items()` — gestion des mises a jour de position.
- **Calculs** : `src/lib/estimate-calculations.ts` — `computeEstimateLineValues()` calcule les valeurs par ligne, `computeEstimateTotals()` calcule les totaux globaux. Types : `EstimateLineLike`, `EstimateLineValues`, `EstimateTotals`.
- **Serveur** : `src/lib/estimates/server.ts` — operations CRUD completes sur les items, y compris creation de sections et lignes.
- **Impression** : `src/app/dashboard/estimates/[versionId]/print/page.tsx` — vue impression existante.

---

## EST-121 — Sous-totaux par section

**Priorite:** P0 | **Effort:** M | **Milestone:** M0

### User Story

> En tant que chiffreur, je veux voir les sous-totaux HT et TTC de chaque section automatiquement, afin de comparer les couts par lot.

### Criteres d'acceptation

- [ ] Chaque section affiche un sous-total calcule comme la somme des lignes enfants (total_ht_cents, total_ttc_cents)
- [ ] Le sous-total est affiche inline dans la ligne de la section, apres le titre
- [ ] Les sous-totaux sont mis a jour automatiquement lors de toute modification d'une ligne enfant
- [ ] Les sous-totaux sont inclus dans la vue impression avec formatage EUR
- [ ] Les sections vides affichent un sous-total a 0,00 EUR
- [ ] Les sous-totaux tiennent compte de la marge et de la remise appliquees au niveau du devis
- [ ] Decomposition FO/MO dans les sous-totaux : `computeSectionTotals()` retourne `{ foTotalCents, moTotalCents, totalHtCents, totalTtcCents }`
- [ ] Les sous-totaux affichent separement les colonnes FO (fourniture) et MO (main d'oeuvre) dans l'editeur
- [ ] La vue impression inclut les colonnes FO et MO dans les lignes recapitulatives de chaque section

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx`, `src/lib/estimate-calculations.ts` (ajouter `computeSectionTotals()` retournant `{ foTotalCents, moTotalCents, totalHtCents, totalTtcCents }`), `src/app/dashboard/estimates/[versionId]/print/page.tsx`
- Reutiliser : `computeEstimateLineValues()` de `src/lib/estimate-calculations.ts` pour le calcul unitaire de chaque ligne, `formatEUR()` de `src/lib/money.ts` pour l'affichage
- Dependances : aucune

---

## EST-122 — Sections imbriquees (2 niveaux)

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux creer des sous-sections dans une section (ex: Lot 1 > Sous-lot 1.1), afin de structurer finement les devis complexes.

### Criteres d'acceptation

- [ ] Support de 2 niveaux d'imbrication maximum : section > sous-section > lignes
- [ ] Indentation visuelle proportionnelle au niveau de profondeur
- [ ] Le drag-and-drop permet de deplacer une sous-section entre sections parentes
- [ ] Le drag-and-drop d'une ligne permet de la placer dans une sous-section
- [ ] La gestion des positions est coherente a travers les niveaux (parent_id + position)
- [ ] L'ajout d'une sous-section est possible via un bouton contextuel sur une section
- [ ] La suppression d'une section supprime recursivement ses sous-sections et lignes (avec confirmation)
- [ ] Les sous-totaux (EST-121) tiennent compte des sous-sections imbriquees

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx`, `src/lib/estimates/server.ts` (adaptation des operations CRUD pour le niveau 2)
- Fichiers a modifier (DB) : la fonction `reorder_estimate_items()` doit gerer les deplacements inter-niveaux
- Reutiliser : la structure `parent_id` existante dans `estimate_items`, le DnD dnd-kit deja en place dans `EstimateEditorTable`
- Dependances : EST-121

---

## EST-123 — Conversion section / ligne

**Priorite:** P2 | **Effort:** S

### User Story

> En tant que chiffreur, je veux convertir une ligne en section (et inversement), afin de restructurer mon devis sans recreer les elements.

### Criteres d'acceptation

- [ ] Menu contextuel (clic droit ou bouton "...") avec l'option "Convertir en section" sur une ligne et "Convertir en ligne" sur une section
- [ ] La conversion preserve le titre (designation) et la position dans l'arbre
- [ ] Conversion section vers ligne : les champs numeriques sont initialises (quantite = 1, prix unitaire = 0)
- [ ] Conversion ligne vers section : les champs numeriques sont effaces (quantite, prix unitaire, etc.)
- [ ] Conversion section vers ligne : les lignes enfants sont rattachees au parent de la section convertie
- [ ] Conversion groupee possible sur les lignes selectionnees (multi-selection)
- [ ] L'action est annulable via Undo (EST-106)

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx` (ajout de l'action dans le menu contextuel)
- Fichiers a modifier : `src/lib/estimates/server.ts` ou logique cote client pour la mutation de `item_type`
- Reutiliser : `onPatchItem()` existant pour la mise a jour du type, les schemas Zod de `src/lib/estimates/schemas.ts`
- Dependances : aucune

---

## EST-124 — Numerotation automatique

**Priorite:** P1 | **Effort:** S

### User Story

> En tant que chiffreur, je veux que les sections et lignes soient numerotees automatiquement (1, 1.1, 1.1.1), afin de referencer facilement les postes dans le devis.

### Criteres d'acceptation

- [ ] Numerotation hierarchique basee sur la position et le parent : sections = 1, 2, 3... ; sous-sections = 1.1, 1.2... ; lignes = 1.1.1, 1.1.2...
- [ ] La numerotation se met a jour automatiquement lors de tout reordonnancement (drag-and-drop, deplacement)
- [ ] La numerotation est affichee dans le tableau editeur (colonne dediee ou prefixe du titre)
- [ ] La numerotation est incluse dans la vue impression
- [ ] Format configurable : numerique (1.1) ou mixte (I.A.1) selon les preferences du devis
- [ ] La numerotation est purement affichee (calculee a la volee), non stockee en base
- [ ] Prefixe LOT optionnel depuis les metadonnees du projet (ex: "LOT4-1.1.1")
- [ ] Le prefixe LOT est compatible avec le format du champ Position des DPGF clients

### Notes techniques

- Fichiers a creer : `src/lib/estimates/numbering.ts`
- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx`, `src/app/dashboard/estimates/[versionId]/print/page.tsx`
- Reutiliser : la structure arborescente (parent_id + position) de `estimate_items`, la logique de tri existante dans `EstimateEditorTable`
- Dependances : EST-122

---

## EST-033 — Identifiant structure AID

**Priorite:** P2 | **Effort:** S | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux un identifiant structure (AID) par ligne au format [Matiere].[Type].[DN], afin de referencer les articles et assurer la coherence avec le catalogue.

> **Origine PRD:** `MM_appro.xlsm` — identifiant AID structure utilise pour la gestion des stocks et le referencement fournisseur.

### Criteres d'acceptation

- [ ] Nouvelle colonne `aid` (text, nullable) sur `estimate_items`
- [ ] Validation pattern configurable par tenant (regex, defaut : `^[A-Z]{2,4}\.[A-Z]{2,4}\.\d{2,4}$`)
- [ ] Auto-generation de l'AID lors du match catalogue (EST-164) : construit a partir des metadonnees du produit catalogue
- [ ] L'AID est affiche comme premiere colonne visible dans l'editeur (avant la designation)
- [ ] L'AID est inclus dans les exports DPGF, BDC et dans la vue impression
- [ ] Recherche par AID dans l'editeur (filtre rapide)
- [ ] L'import OPTIMA et BDC (EST-034, EST-104) mappent la colonne AID si presente

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/0xx_aid_column.sql` — colonne `aid` sur `estimate_items`
- Fichiers a modifier :
  - `src/components/estimates/EstimateEditorTable.tsx` — colonne AID en premiere position, filtre rapide
  - `src/lib/estimates/schemas.ts` — ajouter `aid` aux schemas de validation
  - `src/app/dashboard/estimates/[versionId]/print/page.tsx` — colonne AID dans l'impression
- Reutiliser :
  - Pattern des colonnes existantes dans `EstimateEditorTable`
  - Logique de match catalogue de EST-164 pour l'auto-generation
- Dependances : EST-164 (auto-generation depuis le match catalogue)

# UX2-E04 — Editeur Simplifie (80/20 Layout)

> Milestone: M2 | Priorite: P1 | Statut: A faire

## Objectif

Simplifier l'editeur de chiffrage pour que 80% de l'ecran soit dedie aux colonnes
essentielles (designation, quantite, unite, PU HT, total) et que les colonnes avancees
(k_fo, h_mo, k_mo, type fourniture, role MO) soient masquees par defaut en mode Simplifie.
Le settings panel (marge, TVA, remise, arrondi) est condense en une barre de resume
toujours visible avec expansion on-demand.

## Ce qui existe deja

- **`src/app/dashboard/estimates/[versionId]/edit/page.tsx`** : Page editeur monolithique
  (~7000 lignes), toolbar en haut, settings dans un drawer lateral droit. Contient :
  toolbar, alertes, `EstimateEditorTable`, drawers (settings, labor roles, margin tiers,
  suggestions rules, events timeline), dialogs (bulk suggest, import from estimate, send gating)
- **`src/hooks/useColumnVisibility.ts`** : Systeme de presets (essential/standard/full/custom)
  avec colonnes avancees (supply_type, k_fo, h_mo_majoration, labor_role, k_mo).
  Preset "essential" = designation, quantity, unit, pu_ht, total. Persiste localStorage.
- **`src/components/estimates/EstimateSettingsPanel.tsx`** : Panel de parametres dans le
  drawer : marge (multiplicateur ou tiers), TVA, remise (simple/cascade), arrondi, devise,
  coefficient global
- **`src/components/estimates/EstimateChecklist.tsx`** : Checklist qualite avec criteres
  bloquants/warning/complets, collapse/expand
- **`src/components/estimates/context/EstimateEditorContext.tsx`** : Context React pour
  l'etat editeur

---

## UX2-013 — Barre de resume des parametres (Settings Summary Bar)

**Priorite:** P1 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux voir un resume compact de mes parametres (marge, TVA,
> remise, total HT/TTC) en permanence au-dessus du tableau, afin de ne pas ouvrir le
> drawer juste pour verifier une valeur.

### Criteres d'acceptation

- [ ] Barre horizontale fixe au-dessus du tableau editeur affichant :
      marge (%), TVA (%), remise (montant ou %), total HT, total TTC
- [ ] Chaque valeur est cliquable et ouvre le drawer settings directement sur la section
      correspondante (ex: clic sur marge → drawer ouvert a la section marge)
- [ ] La barre est responsive : sur mobile, les valeurs sont sur 2 lignes
- [ ] Le bouton "Parametres" (engrenage) est positionne a droite de la barre
      pour ouvrir le drawer complet
- [ ] Les totaux se mettent a jour en temps reel quand les items changent
      (reactive via le contexte editeur)
- [ ] En mode Simplifie : seuls total HT et marge sont visibles (le reste en hover/tooltip)
- [ ] En mode Expert : toutes les valeurs sont visibles
- [ ] Les valeurs derivees (totaux, pourcentages) sont calculees au render memoise
      plutot que via chaines d'effets (`rerender-derived-state-no-effect`)

### Notes techniques

- Fichiers a creer :
  - `src/components/estimates/EstimateSettingsSummaryBar.tsx`
- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — insertion de la barre
    entre la toolbar et le tableau
- Reutiliser :
  - `computeEstimateTotals()` de `src/lib/estimate-calculations.ts`
  - `formatCurrency()` / `formatEUR()` de `src/lib/money.ts`
  - Le contexte editeur pour les donnees reactives
- Dependances : Aucune

---

## UX2-014 — Preset colonnes "Essentiel" par defaut en mode Simplifie

**Priorite:** P1 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant que chiffreur junior, je veux que l'editeur affiche par defaut uniquement les
> colonnes essentielles (designation, quantite, unite, PU HT, total), afin de ne pas etre
> submerge par les colonnes techniques comme k_fo, h_mo ou k_mo.

### Criteres d'acceptation

- [ ] En mode Simplifie : preset "essential" force au premier chargement
      (designation, quantity, unit, pu_ht, total)
- [ ] En mode Expert : preset "standard" ou dernier preset utilise (persiste localStorage)
- [ ] Un bouton "Colonnes avancees" est visible dans la toolbar avec un indicateur
      du nombre de colonnes masquees (ex: "+5 colonnes")
- [ ] Cliquer sur le bouton bascule vers le preset "full" (toggle)
- [ ] Le choix est persiste en localStorage (comportement deja existant)
- [ ] Le changement de mode interface (Simplifie ↔ Expert) ne reset pas le preset
      si l'utilisateur l'a modifie manuellement

### Notes techniques

- Fichiers a modifier :
  - `src/hooks/useColumnVisibility.ts` — ajouter la logique de defaut conditionnel
    base sur `useUiMode()`
  - Toolbar dans `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — ajouter
    le bouton toggle colonnes
- Reutiliser :
  - Hook `useColumnVisibility` existant (presets essential/standard/full/custom)
  - Hook `useUiMode()` de UX2-001
- Dependances : UX2-001

---

## UX2-015 — Toolbar compacte 2-row avec groupes logiques

**Priorite:** P1 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux une toolbar organisee en 2 lignes logiques (actions
> principales en haut, filtres/options en bas), afin de voir toutes les actions
> disponibles sans scroll horizontal.

### Criteres d'acceptation

- [ ] Row 1 (actions principales) : Titre (nom projet + version), statut badge,
      auto-save indicator, boutons principaux (Envoyer, Exporter, Plus d'actions, Retour)
- [ ] Row 2 (filtres/options) : Toggle colonnes, filtre qualite (anomalies), compteur
      de lignes (N sections, M lignes), bouton settings (→ summary bar clic), bouton
      checklist
- [ ] En mode Simplifie : Row 2 montre seulement toggle colonnes + compteur + settings
- [ ] En mode Expert : Row 2 montre tous les controles + bouton "Suggestions auto"
- [ ] Sur mobile : Row 1 seul visible, Row 2 dans un menu overflow (bouton "...")
- [ ] La toolbar est sticky (fixee en haut au scroll du contenu)
- [ ] Les espacements et tailles suivent les classes CSS existantes (`btn-sm`, etc.)
- [ ] Les controles/filtres non urgents de Row 2 utilisent `startTransition`
      pour ne pas bloquer l'edition (`rerender-transitions`)

### Notes techniques

- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — refactorer la section
    render du header (actuellement en flex wrap, ~100 lignes)
- Reutiliser :
  - Tous les composants de toolbar existants : `ExportDropdown`, `BulkSuggestDialog`
    trigger, `EstimateChecklist` toggle, `EstimateStatusActions`
  - `useUiMode()` pour le conditional rendering
- Dependances : UX2-013, UX2-014

---

## UX2-016 — Split du fichier editeur monolithique

**Priorite:** P2 | **Effort:** L | **Couches:** `[Front]`

### User Story

> En tant que developpeur, je veux que le fichier editeur de ~7000 lignes soit decoupe en
> modules plus petits et testables, afin de pouvoir modifier l'UX sans risque de regression
> et ameliorer la maintenabilite.

### Criteres d'acceptation

- [ ] Le fichier `edit/page.tsx` est decoupe en :
  - `EstimateEditorPage.tsx` — orchestration (< 500 lignes)
  - `EstimateEditorToolbar.tsx` — toolbar (rows 1 et 2)
  - `EstimateEditorDrawer.tsx` — drawer settings (labor roles, margin tiers, rules, timeline)
  - `EstimateEditorAlerts.tsx` — section alertes/banniere
  - `useEstimateEditorState.ts` — etat principal (items, selection, undo/redo, auto-save)
- [ ] Aucune regression fonctionnelle : suites Vitest pertinentes + Playwright critique passent
- [ ] Le fichier principal `edit/page.tsx` importe les modules et fait < 200 lignes
- [ ] Les modules partagent l'etat via `EstimateEditorContext` existant
- [ ] Frontieres RSC explicites :
      `page.tsx` reste Server Component d'orchestration,
      modules interactifs en Client Components non-async
- [ ] Les props passees Server -> Client restent serializables
- [ ] Les sous-arbres couteux (table, drawer, checklist) sont extraits et memoises
      pour reduire les rerenders (`rerender-memo`)

### Notes techniques

- Fichiers a creer :
  - `src/components/estimates/editor/EstimateEditorToolbar.tsx`
  - `src/components/estimates/editor/EstimateEditorDrawer.tsx`
  - `src/components/estimates/editor/EstimateEditorAlerts.tsx`
  - `src/hooks/useEstimateEditorState.ts`
- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — extraction
- Reutiliser :
  - `src/components/estimates/context/EstimateEditorContext.tsx` pour le partage d'etat
- Dependances : UX2-015 (definir la toolbar avant de la separer)

---

## UX2-017 — Mode lecture seule pour le role viewer

**Priorite:** P1 | **Effort:** S | **Couches:** `[DB]` `[Front]`

### User Story

> En tant que lecteur (viewer), je veux voir l'editeur en mode lecture seule sans boutons
> d'edition, afin de consulter le chiffrage sans risque de modification accidentelle.

### Criteres d'acceptation

- [ ] Si `tenant_role === 'viewer'`, l'editeur n'affiche pas :
      boutons ajouter/supprimer ligne, inline editing, DnD, toolbar d'edition,
      bouton "Envoyer", bouton "Suggestions auto"
- [ ] Les boutons export (PDF, Excel, CSV) restent disponibles
- [ ] Un bandeau "Mode consultation — vous ne pouvez pas modifier ce chiffrage" est
      affiche en haut, en style `alert-info`
- [ ] L'URL `/edit` reste accessible (pas de redirect) mais les interactions d'edition
      sont bloquees
- [ ] Le settings panel est consultable en lecture seule (drawer ouvrable sans edition)
- [ ] Les policies RLS de `estimate_items` bloquent INSERT/UPDATE/DELETE pour
      le role `viewer` (autoriser `admin`/`engineer` uniquement)
- [ ] Les predicates de policy restent indexables et alignes avec `tenant_id`/`version_id`

### Notes techniques

- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — enrichir la variable
    `isSaveBlocked` pour inclure le check `tenant_role === 'viewer'`
  - `src/components/estimates/EstimateEditorTable.tsx` — conditionner le DnD et
    l'inline editing
- Fichiers a creer :
  - `supabase/migrations/YYYYMMDD_ux2_017_rls_viewer_readonly.sql`
- Reutiliser :
  - `useUserContext()` pour `profile.tenant_role`
  - La logique `isSaveBlocked` et `isStatusReadOnly` existantes
- Dependances : Aucune
- **Note securite** : le guard UI complete la securite mais ne la remplace pas.
  La fermeture RLS fait partie du livrable UX2-017.

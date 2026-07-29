# EST-E06 — Turbo Editor (tableur + bulk)

> Milestone: M1 | Priorite: P0 | Statut: A faire

## Objectif

Transformer l'editeur de devis en une experience de type tableur avec navigation clavier, edition inline, copier/coller et multi-selection pour une saisie rapide des donnees. C'est le coeur fonctionnel de la V1 : le chiffreur doit pouvoir saisir et modifier un devis aussi vite que dans Excel.

## Ce qui existe deja

- **Tableau editeur** : `src/components/estimates/EstimateEditorTable.tsx` — tableau avec DnD via dnd-kit, arbre sections/lignes, edition par champ, affichage des drapeaux qualite. Utilise `onPatchItem()` pour les mises a jour unitaires.
- **Sauvegarde bulk** : `bulkUpdateEstimateItems()` dans `src/lib/estimates/server.ts` pour la sauvegarde groupee.
- **Fonction DB** : `bulk_update_estimate_items()` et `reorder_estimate_items()` pour les operations en masse cote base.
- **Calculs** : `src/lib/estimate-calculations.ts` — `computeEstimateLineValues()`, `computeEstimateTotals()`, `normalizeDraftItems()`. Types : `EstimateLineLike`, `EstimateLineValues`, `EstimateTotals`, `RoundingMode`.
- **Qualite** : `src/lib/estimate-quality.ts` — drapeaux qualite affiches inline dans le tableau.
- **Schemas** : `src/lib/estimates/schemas.ts` — validation Zod pour toutes les mutations.

---

## EST-101 — Navigation clavier tableur

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que chiffreur, je veux naviguer dans le tableau avec Tab, Entree et les fleches comme dans un tableur, afin de saisir rapidement sans toucher la souris.

### Criteres d'acceptation

- [ ] Tab deplace le focus vers la cellule suivante (gauche a droite, puis ligne suivante)
- [ ] Shift+Tab deplace le focus vers la cellule precedente
- [ ] Entree valide la saisie et deplace le focus vers la cellule du dessous
- [ ] Echap annule la saisie en cours et restaure la valeur precedente
- [ ] Les fleches (haut/bas/gauche/droite) naviguent entre cellules quand la cellule n'est pas en mode edition
- [ ] Le focus ring est visible et respecte les regles d'accessibilite (contraste suffisant)
- [ ] La gestion du focus est au niveau cellule, pas au niveau champ HTML
- [ ] Les sections (item_type='section') sont navigables mais seul le champ titre est editable
- [ ] **Benchmark index** : `EXPLAIN ANALYZE` sur fetch tree / bulk update / reorder avec 3000 lignes. Index composite cree uniquement si seq scan detecte (ne PAS creer d'index en aveugle — 4 index pertinents existent deja)
- [ ] **Schema bulk** : `updateEstimateItemSchema` etendu pour accepter `pu_ht_cents`, `line_total_ht_cents`, `line_tax_cents`, `line_total_ttc_cents` en optionnel (resout le Bloquant 2 : Zod filtre actuellement ces champs)
- [ ] **Endpoint atomique** : bulk items + totaux version persistes dans une seule transaction serveur (remplace le `setTimeout` deferred actuel dans `page.tsx:834`)
- [ ] Bulk edit sur 100 lignes : 1 seule requete API, recalcul coherent

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx`
- Fichiers a creer : `src/hooks/useSpreadsheetNavigation.ts`
- Reutiliser : la structure arborescente existante de `EstimateEditorTable` (sections/lignes avec `parent_id` et `position`)
- **Pattern recalc cible** : client JS pre-compute (`computeEstimateLineValues` + `computeEstimateTotals`) → endpoint serveur atomique → `bulk_update_estimate_items()` avec totaux pre-calcules + `patchEstimateVersion()` totaux globaux dans une meme RPC ou appel sequentiel serveur. Le `setTimeout` dans `page.tsx:834` est un contournement temporaire resolu par cette story
- Dependances : aucune

---

## EST-102 — Edition inline rapide

**Priorite:** P0 | **Effort:** M

### User Story

> En tant que chiffreur, je veux cliquer ou taper sur une cellule pour editer directement la valeur, afin de gagner du temps sur la saisie.

### Criteres d'acceptation

- [ ] Simple clic sur une cellule entre en mode edition avec le curseur positionne
- [ ] Double clic selectionne tout le contenu de la cellule
- [ ] Taper un caractere remplace le contenu existant (mode remplacement)
- [ ] Le blur (perte de focus) sauvegarde automatiquement la valeur
- [ ] Les champs numeriques sont formates a la sortie du mode edition (separateur de milliers, 2 decimales pour les prix)
- [ ] Ctrl+Z annule la derniere modification dans la cellule active (undo local)
- [ ] Les cellules en lecture seule (champs calcules comme total_ht) ne sont pas editables mais restent navigables

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx`
- Fichiers a creer : `src/components/estimates/EditableCell.tsx`
- Reutiliser : `onPatchItem()` existant pour la persistance unitaire, `parseEuroToCents()` et `formatEUR()` de `src/lib/money.ts` pour le formatage
- Dependances : EST-101

---

## EST-103 — Multi-selection et actions groupees

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que chiffreur, je veux selectionner plusieurs lignes (Ctrl+clic, Shift+clic) et appliquer une action groupee (supprimer, deplacer, modifier categorie), afin de gerer efficacement les lots de lignes.

### Criteres d'acceptation

- [ ] Ctrl+Clic bascule la selection d'une ligne individuelle
- [ ] Shift+Clic selectionne la plage entre la derniere ligne selectionnee et la ligne cliquee
- [ ] Ctrl+A selectionne toutes les lignes (pas les sections)
- [ ] Indicateur du nombre de lignes selectionnees affiche dans la barre d'outils
- [ ] Actions groupees disponibles : supprimer, deplacer dans une section, modifier la categorie, modifier le role main-d'oeuvre
- [ ] Raccourci clavier Suppr pour supprimer les lignes selectionnees (avec confirmation)
- [ ] La selection est preservee apres une action groupee (sauf suppression)
- [ ] Deselection avec Echap ou clic sur une zone vide

### Notes techniques

- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx`
- Fichiers a creer : `src/hooks/useMultiSelect.ts`
- Reutiliser : `bulkUpdateEstimateItems()` de `src/lib/estimates/server.ts` et la fonction DB `bulk_update_estimate_items()` pour les actions groupees
- Dependances : EST-101

---

## EST-104 — Copier/Coller depuis Excel

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux copier des lignes depuis Excel et les coller dans l'editeur, afin d'importer rapidement des donnees sans passer par l'import DPGF.

### Criteres d'acceptation

- [ ] Ctrl+V detecte le contenu TSV (tab-separated values) dans le presse-papier
- [ ] Le parsing identifie les colonnes : designation, quantite, unite, prix unitaire, categorie
- [ ] Une boite de dialogue de previsualisation affiche les lignes detectees avant insertion
- [ ] Un dialogue de mapping des colonnes s'affiche si les colonnes sont ambigues ou dans un ordre inattendu
- [ ] Ctrl+C copie les lignes selectionnees au format TSV (compatible Excel)
- [ ] Les valeurs numeriques sont parsees en tenant compte des formats francais (virgule decimale)
- [ ] Les lignes vides ou invalides sont signalees dans la previsualisation avec possibilite de les exclure
- [ ] Auto-detection du layout BDC V1.1 quand les colonnes correspondent (AID, Material, Dimension, PR.FO, K FO, h MO, K MO...)
- [ ] Auto-detection du layout OPTIMA quand les colonnes correspondent (Designation, Unite, Qte, PU, Coeff FO, Coeff MO, Tps pose, Majoration MO)
- [ ] Indicateur de format detecte dans le dialogue de preview ("Format BDC V1.1 detecte" ou "Format OPTIMA detecte")
- [ ] Mapping automatique des colonnes detectees vers les champs correspondants de l'editeur

### Notes techniques

- Fichiers a creer : `src/lib/estimates/clipboard.ts`, `src/components/estimates/PastePreviewDialog.tsx`
- Fichiers a modifier : `src/components/estimates/EstimateEditorTable.tsx`
- Reutiliser : `normalizeDraftItems()` de `src/lib/estimate-calculations.ts` pour normaliser les lignes importees, `parseEuroToCents()` de `src/lib/money.ts` pour la conversion des montants
- Dependances : EST-103

---

## EST-105 — Auto-save debounce

**Priorite:** P0 | **Effort:** M

### User Story

> En tant que chiffreur, je veux que mes modifications soient sauvegardees automatiquement apres 2 secondes d'inactivite, afin de ne jamais perdre mon travail.

### Criteres d'acceptation

- [ ] Les modifications sont sauvegardees automatiquement 2 secondes apres la derniere frappe/modification
- [ ] Indicateur visuel de l'etat de sauvegarde : "Sauvegarde en cours...", "Sauvegarde", "Erreur de sauvegarde"
- [ ] Les modifications en attente sont regroupees en un seul appel bulk (batch)
- [ ] Detection de conflit : si la version a ete modifiee par un autre utilisateur, un message d'avertissement s'affiche
- [ ] Raccourci Ctrl+S pour forcer la sauvegarde immediate
- [ ] En cas d'erreur reseau, les modifications sont conservees localement et une tentative de re-sauvegarde est effectuee automatiquement
- [ ] La navigation hors de la page est bloquee si des modifications non sauvegardees existent (beforeunload)

### Notes techniques

- Fichiers a creer : `src/hooks/useAutoSave.ts`
- Fichiers a modifier : `src/app/dashboard/estimates/[versionId]/edit/page.tsx`
- Reutiliser : `bulkUpdateEstimateItems()` de `src/lib/estimates/server.ts` pour la sauvegarde groupee, `bulk_update_estimate_items()` DB function
- Dependances : EST-044 (concurrence optimiste)

---

## EST-106 — Undo/Redo global

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux annuler et refaire mes dernieres actions (Ctrl+Z / Ctrl+Shift+Z), afin de corriger rapidement mes erreurs.

### Criteres d'acceptation

- [ ] Pile de commandes avec un maximum de 50 operations memorisees
- [ ] Undo/Redo couvre toutes les mutations sur les items : ajout, suppression, modification, reordonnancement
- [ ] Boutons Undo/Redo visibles dans la barre d'outils avec etat actif/inactif
- [ ] Raccourcis clavier : Ctrl+Z (undo), Ctrl+Shift+Z ou Ctrl+Y (redo)
- [ ] La pile est videe apres une sauvegarde reussie (les modifications sauvegardees ne sont plus annulables)
- [ ] Les actions groupees (multi-selection) comptent comme une seule operation dans la pile
- [ ] L'undo d'une suppression restaure les lignes a leur position d'origine

### Notes techniques

- Fichiers a creer : `src/hooks/useUndoRedo.ts`
- Fichiers a modifier : `src/app/dashboard/estimates/[versionId]/edit/page.tsx`
- Reutiliser : le pattern `onPatchItem()` existant dans `EstimateEditorTable.tsx`, les types `EstimateLineLike` de `src/lib/estimate-calculations.ts`
- Dependances : EST-105

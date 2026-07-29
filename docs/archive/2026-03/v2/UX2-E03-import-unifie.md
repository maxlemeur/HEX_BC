# UX2-E03 — Flux Import-to-Estimate Unifie

> Milestone: M2 | Priorite: P0 | Statut: A faire

## Objectif

Fusionner les 3 pages separees (Import DPGF → Mapping colonnes → Liaison catalogue) en un
seul flux continu dans le contexte d'une affaire. Aujourd'hui l'utilisateur doit naviguer
entre `/dashboard/imports`, `/dashboard/mappings`, `/dashboard/catalogue` avec le `DpgfStepper`
comme seul fil conducteur. Le nouveau flux est : drop fichier → auto-mapping → preview →
confirmation → creation du chiffrage pre-rempli.

**Precision : ou vit la liaison catalogue ?**
La liaison catalogue (lier une ligne DPGF a un produit/fournisseur du pricebook) n'est
**pas une etape d'import** — c'est une action qui se fait **dans l'editeur**, ligne par
ligne, via `selected_supplier_price_id` sur `estimate_items`. Le `BulkSuggestDialog`
existant et les suggestions auto couvrent deja ce besoin. Le UnifiedImportFlow ne couvre
donc que Upload → Mapping → Preview → Confirmation. L'ancien "Step 3 Catalogue" du
`DpgfStepper` est absorbe par l'editeur.

Le Junior est guide pas-a-pas (chaque etape expliquee), le Senior peut accelerer
(auto-mapping accepte si confiance >80%, etape mapping skippee).

## Ce qui existe deja

- **`src/components/DpgfStepper.tsx`** : Stepper 3 etapes avec navigation par URL
  (Import → Mapping → Liaison catalogue), pill-shaped, checkmarks pour etapes completees
- **`src/components/imports/ImportWizard.tsx`** : Wizard d'import avec upload, validation,
  parsing (worker ou server). Etats : idle → validating → scanning → ready/invalid/header_needed
- **`src/components/mappings/MappingWizard.tsx`** : Wizard de mapping colonnes avec
  `ColumnMapper`, auto-mapping via `mapping_memory`, templates sauvegardables
- **`src/components/mappings/ColumnMapper.tsx`** : DnD mapping de colonnes source → champs
  cibles (12 champs : hex_code, designation, quantity, unit, etc.)
- **`src/components/mappings/DataPreview.tsx`** : Preview des lignes mappees avec validation
- **`src/components/catalogue/CatalogueManager.tsx`** : Liaison catalogue avec produits
- **`src/hooks/useImportFlow.ts`** : Hook client avec upload, polling, liste des imports
- **`src/hooks/useFileParser.ts`** : Parsing CSV/XLSX client-side via Web Workers
- **`src/workers/xlsx-parser.worker.ts`** et **`csv-parser.worker.ts`** : Web Workers
- **`supabase/schema.sql`** : Tables `dpgf_imports`, `dpgf_rows_raw`, `dpgf_rows_mapped`,
  `dpgf_mappings`, `mapping_templates`, `mapping_memory`

---

## UX2-009 — Composant UnifiedImportFlow (multi-step inline)

**Priorite:** P0 | **Effort:** L | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur, je veux importer un DPGF, mapper les colonnes et previsualiser le
> resultat dans un seul ecran sans changer de page, afin de gagner du temps et garder le
> contexte de mon affaire.

### Criteres d'acceptation

- [ ] Nouveau composant `UnifiedImportFlow` avec 4 etapes inline (pas de navigation URL) :
      Upload → Mapping → Preview → Confirmation
- [ ] Etape 1 (Upload) : drag & drop du fichier, detection automatique du format
      (CSV/XLSX/XLS), parsing client-side via worker existant, indicateur de progression
- [ ] Etape 2 (Mapping) : propose un auto-mapping base sur `mapping_memory` et
      `mapping_templates`, avec edition manuelle via `ColumnMapper` existant
- [ ] Etape 3 (Preview) : tableau des lignes mappees avec indicateurs de qualite
      (champs manquants, doublons), compteur de lignes valides/invalides
- [ ] Etape 4 (Confirmation) : resume du nombre de lignes, option de creer le chiffrage
      directement ou de retourner au hub affaire
- [ ] Bouton "Retour" a chaque etape, progression visible en haut (barre ou steps)
- [ ] En mode Simplifie : si auto-mapping confiance >80%, l'etape Mapping est auto-validee
      avec un bandeau "Mapping automatique applique" et un lien "Modifier le mapping"
- [ ] En mode Expert : toutes les etapes sont visibles avec controle fin
- [ ] Le composant accepte un `projectId` prop pour lier l'import au projet
- [ ] Le composant est reutilisable dans le hub affaire et dans la modale de creation
- [ ] Ecriture de `dpgf_rows_raw` / `dpgf_rows_mapped` en batch insert (lots)
      plutot qu'en insert unitaire ligne par ligne
- [ ] Confirmation finale via Server Action avec transaction courte
      (parsing/calcul hors transaction, commit reserve aux ecritures atomiques)
- [ ] Les sous-composants lourds (mapping, preview) sont charges conditionnellement
      selon l'etape active (`bundle-conditional` / `bundle-dynamic-imports`)
- [ ] Les updates UI non urgentes (progress, stats auxiliaires) utilisent
      `startTransition` pour garder la saisie fluide (`rerender-transitions`)
- [ ] Couverture Playwright: parcours complet Upload -> Mapping -> Preview -> Confirmation
      (modes Simplifie et Expert)

### Notes techniques

- Fichiers a creer :
  - `src/components/affaires/UnifiedImportFlow.tsx`
  - `src/app/dashboard/affaires/_actions/import-flow.ts`
- Reutiliser :
  - `useFileParser` de `src/hooks/useFileParser.ts` (parsing)
  - `useImportFlow` de `src/hooks/useImportFlow.ts` (upload API)
  - `ColumnMapper` de `src/components/mappings/ColumnMapper.tsx` (mapping UI)
  - `DataPreview` de `src/components/mappings/DataPreview.tsx` (preview)
  - `useUiMode()` pour conditionner le comportement simplifie/expert
  - `next/dynamic` pour les etapes non critiques au premier rendu
- Dependances : UX2-007

---

## UX2-010 — Auto-mapping intelligent avec score de confiance

**Priorite:** P1 | **Effort:** M | **Couches:** `[DB]` `[Back]` `[Front]`

### User Story

> En tant que chiffreur senior, je veux que le systeme propose automatiquement le mapping
> des colonnes avec un score de confiance visible, afin de valider en un clic au lieu de
> mapper manuellement chaque colonne.

### Criteres d'acceptation

- [ ] Lorsque les colonnes du fichier sont detectees, le systeme consulte `mapping_memory`
      et `mapping_templates` pour proposer un mapping
- [ ] Chaque mapping propose affiche un badge de confiance :
      vert (>80%), orange (50-80%), rouge (<50%)
- [ ] Si un template exact match le fichier (memes colonnes source), il est applique
      automatiquement avec un message "Mapping applique depuis le template {nom}"
- [ ] L'utilisateur peut corriger tout mapping propose avant validation
- [ ] Apres validation, le `mapping_memory` est mis a jour (`usage_count++`,
      `confidence` recalculee)
- [ ] En mode Simplifie, si tous les mappings required sont >80%, l'etape est auto-validee
- [ ] La mise a jour de `mapping_memory` est atomique en `UPSERT`
      (`INSERT ... ON CONFLICT ... DO UPDATE`)
- [ ] Une contrainte unique supporte l'UPSERT sur la cle fonctionnelle
      (`tenant_id`, `user_id`, `source_column`, `target_field`)
- [ ] Les lectures serveur repetitives (templates/memory) sont dedupliquees
      par requete via `React.cache()` (`server-cache-react`)

### Notes techniques

- Fichiers a modifier :
  - `src/components/mappings/ColumnMapper.tsx` — ajouter les badges de confiance
  - `src/lib/mappings/server.ts` — logique de calcul du score de confiance
- Fichiers a creer :
  - `supabase/migrations/YYYYMMDD_ux2_010_mapping_memory_upsert.sql`
- Reutiliser :
  - Table `mapping_memory` avec colonnes `confidence`, `usage_count`
  - Table `mapping_templates` pour le matching de templates
- Dependances : UX2-009

---

## UX2-011 — Bouton "Nouvelle affaire" avec import DPGF integre

**Priorite:** P0 | **Effort:** M | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur, je veux pouvoir creer une nouvelle affaire en deposant directement
> un fichier DPGF, afin que le systeme cree le projet, parse le fichier, et me place dans
> l'editeur avec les lignes pre-remplies en un minimum de clics.

### Criteres d'acceptation

- [ ] Le bouton "Nouvelle affaire" de la page liste ouvre un dialog simplifie avec :
      nom projet (obligatoire), client (optionnel), reference (optionnel),
      zone de drop DPGF (optionnel)
- [ ] Si un fichier DPGF est depose, le flux enchaine :
      parsing → auto-mapping → creation projet + version + items → redirect editeur
- [ ] Si pas de DPGF, le projet est cree vide et l'utilisateur est redirige vers
      le hub affaire avec le message "Affaire creee — commencez le chiffrage"
- [ ] En mode Simplifie : seuls nom projet et zone drop sont visibles
      (client/reference en section "Plus d'options")
- [ ] En mode Expert : tous les champs visibles + acces a "Creation avancee"
      (ancien wizard 3 etapes pour choisir template, parametres de marge, etc.)
- [ ] L'ancien `EstimateCreationWizard` reste accessible via le lien "Creation avancee"
- [ ] Mutation "creer affaire + version + items" implementee en Server Action
      (pas via route handler interne dedie)
- [ ] L'insertion des `estimate_items` issus de l'import se fait en batch
- [ ] `redirect()` est appele hors `try/catch` (ou `unstable_rethrow`) pour respecter
      le comportement Next.js des APIs de navigation
- [ ] Chaque Server Action valide authN/authZ + payload en interne
      (`server-auth-actions`)
- [ ] Tests Vitest sur la logique serveur de creation (validation payload, branches
      avec/sans DPGF) + Playwright sur le flux utilisateur

### Notes techniques

- Fichiers a creer :
  - `src/components/affaires/QuickCreateAffaireDialog.tsx`
  - `src/app/dashboard/affaires/_actions/quick-create-affaire.ts`
- Fichiers a modifier :
  - `src/app/dashboard/affaires/page.tsx` — bouton header
- Reutiliser :
  - `createEstimate()` cote serveur
  - `UnifiedImportFlow` de UX2-009 (integre dans le dialog)
  - `useUiMode()` pour le conditional rendering
- Dependances : UX2-005, UX2-009

---

## UX2-012 — Deprecation des pages Import/Mapping standalone

**Priorite:** P2 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux etre redirige vers le bon contexte affaire quand j'accede
> aux anciennes URLs d'import ou de mapping, afin de ne pas etre desoriente par des pages
> qui ne font plus partie du flux principal.

### Criteres d'acceptation

- [ ] `/dashboard/imports` affiche un bandeau info "Cette page sera bientot remplacee —
      utilisez le flux import depuis vos affaires" avec lien vers `/dashboard/affaires`
- [ ] `/dashboard/mappings` idem
- [ ] `/dashboard/catalogue` idem (la liaison catalogue se fait desormais depuis le hub)
- [ ] Les fonctionnalites restent operationnelles pendant la periode de transition
      (bandeau non bloquant)
- [ ] Les imports qui ont un `project_id` affichent un lien "Voir l'affaire" en plus

### Notes techniques

- Fichiers a modifier :
  - `src/app/dashboard/imports/page.tsx` — ajouter le bandeau deprecation
  - `src/app/dashboard/mappings/page.tsx` — idem
  - `src/app/dashboard/catalogue/page.tsx` — idem
- Dependances : UX2-009, UX2-011

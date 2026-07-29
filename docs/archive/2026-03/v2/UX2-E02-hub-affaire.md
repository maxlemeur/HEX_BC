# UX2-E02 — Hub Affaire (Projet Dashboard)

> Milestone: M1 | Priorite: P0 | Statut: A faire

## Objectif

Creer un concept central d'"Affaire" qui regroupe tout ce qui concerne un projet : le DPGF
source, les versions de chiffrage, les documents, le resume financier, la timeline. Aujourd'hui,
`estimate_projects` existe mais n'a pas de page dediee — l'utilisateur voit directement la
liste des versions a plat. L'affaire devient le point d'entree principal du chiffreur.

## Ce qui existe deja

- **`supabase/schema.sql`** : Table `estimate_projects` avec `id, name, reference,
  client_name, notes, is_archived, tenant_id`
- **`supabase/schema.sql`** : Table `estimate_versions` avec FK `project_id →
  estimate_projects(id)` — chaque version a un `status`, `version_number`, tous les
  parametres financiers et totaux
- **`supabase/schema.sql`** : Table `dpgf_imports` — actuellement pas de FK vers
  `estimate_projects` (le lien est implicite)
- **`src/app/dashboard/estimates/page.tsx`** : Liste des versions a plat (pas groupees
  par projet), avec filtres, tri, pagination
- **`src/app/dashboard/estimates/[versionId]/page.tsx`** : Detail d'une version unique
- **`src/lib/estimates/client.ts`** : `fetchEstimateList()` retourne `EstimateListItem[]`
  avec `projectId, projectName, versionId`
- **`src/components/estimates/EstimateTimeline.tsx`** : Composant timeline des versions
- **`src/components/HubBreadcrumb.tsx`** : Composant breadcrumb reutilisable
- **`src/components/estimates/EstimateDashboard.tsx`** : Dashboard KPI global

---

## UX2-005 — Page liste des affaires `/dashboard/affaires`

**Priorite:** P0 | **Effort:** L | **Couches:** `[DB]` `[Back]` `[Front]`

### User Story

> En tant que chiffreur, je veux voir la liste de mes affaires (projets) avec leur statut
> global, client et dernier chiffrage, afin de retrouver rapidement un dossier en cours.

### Criteres d'acceptation

- [ ] Nouvelle page `/dashboard/affaires` accessible depuis la sidebar "Mes affaires"
- [ ] Chaque carte/ligne affiche : nom du projet, client, reference, nombre de versions,
      **2 indicateurs de statut** :
      (1) statut courant = statut de la version avec le plus grand `version_number`
      (= travail en cours, ex: "V3 Brouillon"),
      (2) badge "derniere acceptee" si une version `accepted` existe
      (ex: "V2 Acceptee") — cela couvre le cas V3 draft + V2 accepted,
      total HT de la derniere version, date de derniere modification
- [ ] Filtres : recherche texte (nom + client), filtre par statut, tri par date/nom/montant
- [ ] Pagination en curseur (keyset) 20/50/100 par page, sans `OFFSET`
      (curseur base sur `(updated_at, id)`, persistance locale du page size)
- [ ] Bouton "Nouvelle affaire" en position primaire dans le header
- [ ] Mode Simplifie : affichage en cartes (visual, scannable)
- [ ] Mode Expert : affichage en tableau dense (plus d'infos par ligne)
- [ ] L'ancien URL `/dashboard/estimates` redirige vers `/dashboard/affaires`
- [ ] Clic sur une affaire navigue vers le hub affaire (UX2-006)
- [ ] Les donnees sont lues en Server Component (ou utilitaire `server.ts`)
      sans route handler interne dediee a l'UI web
- [ ] Requetes P0 validees via `EXPLAIN` et indexes ajoutes pour:
      `estimate_versions(tenant_id, project_id, version_number desc)` et
      index partiel `status = 'accepted'`
- [ ] Couverture Playwright: parcours liste affaires -> hub affaire -> retour liste
- [ ] Les lectures independantes (liste, compteurs, metadata) sont parallelisees
      via `Promise.all` (`async-parallel`)
- [ ] En mode Expert, le tableau dense est charge en `next/dynamic` si son cout bundle
      est significatif (`bundle-dynamic-imports`)

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/affaires/page.tsx`
  - `src/lib/affaires/server.ts` — `fetchAffaireList()`
  - `src/app/dashboard/affaires/loading.tsx`
  - `src/app/dashboard/affaires/error.tsx`
- Fichiers a modifier :
  - `next.config.ts` — redirect `/dashboard/estimates` → `/dashboard/affaires`
- Migrations SQL :
  - `supabase/migrations/YYYYMMDD_ux2_005_affaires_indexes.sql`
- Reutiliser :
  - `FilterSearch`, `SortControl`, `ResultCount` de la page estimates existante
  - `StatusChips` (avec adaptation des libelles)
  - `formatEUR()`, `STATUS_BADGE_STYLES`
- Dependances : Aucune

---

## UX2-006 — Page hub d'une affaire `/dashboard/affaires/[projectId]`

**Priorite:** P0 | **Effort:** L | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur, je veux voir un tableau de bord de mon affaire regroupant toutes
> les versions, le DPGF source, les documents et le resume financier, afin d'avoir une vue
> d'ensemble sans naviguer entre plusieurs pages.

### Criteres d'acceptation

- [ ] 4 sections principales :
  - **Resume financier** : total HT de la version courante (plus grand `version_number`),
    total de la derniere version `accepted` (si existe, affiche separement),
    marge appliquee (%), nombre de lignes
  - **Versions** : timeline verticale avec chaque version (statut, date, montant HT),
    lien direct vers edit ou detail. La version courante et la derniere acceptee sont
    visuellement distinguees (badge, couleur)
  - **Source DPGF** : fichier importe lie et son statut de mapping (si existe).
    La liaison catalogue ne vit pas ici — elle se fait dans l'editeur via les
    suggestions auto et le `BulkSuggestDialog`
  - **Actions rapides** : editer la derniere version, exporter, creer une nouvelle
    version, dupliquer, comparer (si >1 version)
- [ ] Bouton "Comparer versions" visible si plus d'une version existe
      (lien vers le diff existant `/dashboard/estimates/[id]/diff`)
- [ ] En mode Expert : section "Analyse marge" supplementaire (cf. UX2-021)
- [ ] Page responsive : sections empilees sur mobile, 2 colonnes sur desktop
- [ ] Bouton "Retour a la liste" en haut a gauche
- [ ] Route dynamique conforme Next.js 15+ :
      `params: Promise<{ projectId: string }>` puis `await params`
- [ ] `notFound()` si l'affaire n'existe pas ou n'est pas accessible,
      avec `not-found.tsx` dedie
- [ ] Chargements paralleles des blocs (resume, versions, DPGF) via `Promise.all`
      pour eviter les waterfalls
- [ ] Les sections lentes du hub utilisent des frontieres `Suspense`
      pour streamer l'UI (`async-suspense-boundaries`)
- [ ] Couverture Playwright: rendu hub (cas normal + affaire inexistante -> `notFound`)

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/affaires/[projectId]/page.tsx`
  - `src/components/affaires/AffaireHub.tsx`
  - `src/app/dashboard/affaires/[projectId]/loading.tsx`
  - `src/app/dashboard/affaires/[projectId]/error.tsx`
  - `src/app/dashboard/affaires/[projectId]/not-found.tsx`
- Reutiliser :
  - `src/lib/affaires/server.ts` pour les lectures DB
  - `React.cache()` sur les fetchers server frequemment reutilises
    (`getAffaireById`, contexte utilisateur)
  - `EstimateTimeline` existant dans `src/components/estimates/EstimateTimeline.tsx`
  - `formatEUR()`, `STATUS_BADGE_STYLES`
  - `computeEstimateTotals()` pour le resume financier
- Dependances : UX2-005

---

## UX2-007 — Lier les imports DPGF a un projet (affaire)

**Priorite:** P1 | **Effort:** M | **Couches:** `[DB]` `[Back]`

### User Story

> En tant que chiffreur, je veux que l'import DPGF soit directement lie a mon affaire, afin
> de ne plus chercher dans une liste separee quel import correspond a quel projet.

### Criteres d'acceptation

- [ ] Nouvelle colonne `project_id uuid REFERENCES estimate_projects(id)` sur
      `dpgf_imports` (nullable pour backward compat avec les imports existants)
- [ ] Lors de la creation d'une affaire avec import (UX2-011), le
      `dpgf_imports.project_id` est renseigne automatiquement
- [ ] Le hub affaire (UX2-006) affiche la section "Source DPGF" en lisant
      `dpgf_imports WHERE project_id = ?`
- [ ] Index composite sur `(tenant_id, project_id, created_at desc)` avec condition
      `project_id is not null` pour les requetes du hub affaire
- [ ] Les anciens imports (sans `project_id`) restent accessibles via
      `/dashboard/imports` (page deprecated mais fonctionnelle)
- [ ] RLS policy mise a jour pour inclure le `project_id` et verifier l'appartenance
      au meme tenant/projet via `exists (...)` indexable
- [ ] Migration idempotente pour FK/contraintes (`DO $$ ... pg_constraint ... $$`)

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/YYYYMMDD_ux2_007_link_dpgf_to_project.sql`
- Fichiers a modifier :
  - `src/hooks/useImportFlow.ts` — accepter un `projectId` optionnel
  - `src/app/dashboard/_actions/imports.ts` — associer `project_id` lors des mutations UI
  - `src/app/api/imports/route.ts` — conserve uniquement la gestion upload binaire
- Reutiliser :
  - Pattern existant des FK dans le schema
- Dependances : UX2-005

---

## UX2-008 — Breadcrumb contextuel affaire dans l'editeur

**Priorite:** P1 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux voir un fil d'Ariane "Mes affaires > Nom du projet >
> V2 - Edition" dans l'editeur, afin de savoir ou je suis et pouvoir remonter facilement
> vers le hub affaire.

### Criteres d'acceptation

- [ ] Breadcrumb present sur toutes les pages sous `/dashboard/affaires/[projectId]/*`
      et sur les pages editeur existantes `/dashboard/estimates/[versionId]/*`
- [ ] Segments : "Mes affaires" → "Nom du projet" → "V{N} - Edition|Detail|Diff|Print"
- [ ] Chaque segment est cliquable et navigue vers la page correspondante
- [ ] Sur mobile, seul le dernier segment + bouton retour fleche sont affiches
- [ ] Le breadcrumb est integre en dessous de la toolbar, au-dessus du contenu
- [ ] Si le breadcrumb utilise `usePathname()` sur route dynamique,
      il est rendu sous `Suspense` (pas de CSR bailout du segment complet)

### Notes techniques

- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — ajouter le breadcrumb
  - `src/app/dashboard/estimates/[versionId]/page.tsx` — idem
- Reutiliser :
  - `src/components/HubBreadcrumb.tsx` — composant breadcrumb deja existant
- Dependances : UX2-006

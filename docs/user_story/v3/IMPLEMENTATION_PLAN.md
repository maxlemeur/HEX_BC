# Plan d'implementation V3 — Track Takeoff / Metre

## Equipes

| Equipe | Profil | Focus principal | Charge (pts) |
|--------|--------|-----------------|-------------|
| **FS** (Fullstack) | Fullstack | Fondation DB (E01), APIs, logique serveur lourde | 14 |
| **FE** (Frontend) | Frontend | Pages UI, adaptation composants existants, workflow front | 14 |

> Points : S=1, M=2, L=3. Total : 28 points, 14 pts/equipe.

---

## Assignation par equipe

### FS — Fondation DB & Logique Serveur (7 stories, 14 pts)

| Story | Titre | Epic | Effort | Couches | Description | Dependances |
|-------|-------|------|--------|---------|-------------|-------------|
| V3-001 | Ajout `project_id` plan_sets | [E01](./V3-E01-plans-project-scope.md) | M (2) | DB | Migration `project_id uuid` nullable FK → `estimate_projects`, index `(tenant_id, project_id, created_at DESC)`. Idempotente. | Aucune |
| V3-002 | RLS project-scope | [E01](./V3-E01-plans-project-scope.md) | M (2) | DB | Fonction `can_access_takeoff_project()`, policies RLS `plan_sets`/`plan_files` OR logique (`project_id` OU `estimate_version_id`). Predicates indexables. | V3-001 |
| V3-003 | API routes project-scoped | [E01](./V3-E01-plans-project-scope.md) | M (2) | Back | Endpoints plan-sets dual-mode (`project_id` ou `estimate_version_id`). Fetcher `fetchPlanSetsForProject()`. Schema Zod dual. Backward compat. | V3-002 |
| V3-004 | Backfill plan_sets | [E01](./V3-E01-plans-project-scope.md) | S (1) | DB | Backfill `project_id` depuis join `estimate_versions`, `project_id` → NOT NULL, `estimate_version_id` → nullable. Requete validation incluse. | V3-001 |
| V3-005 | Card Plans & Metres hub | [E02](./V3-E02-hub-plans-metres.md) | M (2) | Back Front | Fetcher `fetchAffaireHubPlansSummary()` (plan_sets + takeoff_jobs en `Promise.all`). Composant `PlansMetresCard`. Gate par `TAKEOFF_MODULE_ENABLED`. Empty state. | V3-003 |
| V3-010 | Comparaison DPGF vs Takeoff | [E03](./V3-E03-workflow-metre-bridge.md) | L (3) | Back Front | Fetcher `fetchDpgfTakeoffComparison()`. `TakeoffDpgfCompareView` cote-a-cote (qty DPGF vs takeoff, delta, codes couleur). Etend `buildTakeoffDiff()`. Onglet dans review. | V3-007 |
| V3-011 | Carry-over versions | [E03](./V3-E03-workflow-metre-bridge.md) | M (2) | DB Back | Migration `takeoff_version_links`. RLS tenant-scoped. Fetcher `fetchLinkedTakeoffJobs()`. `TakeoffSourceBadge` enrichi "(from V{N})". | V3-001, V3-003 |

### FE — Pages UI & Workflow Front (7 stories, 14 pts)

| Story | Titre | Epic | Effort | Couches | Description | Dependances |
|-------|-------|------|--------|---------|-------------|-------------|
| V3-006 | Page Plan Center affaire | [E02](./V3-E02-hub-plans-metres.md) | L (3) | Back Front | Route `/dashboard/affaires/[projectId]/plans`. Adapte `PlanCenter.tsx` pour `projectId`. CRUD plan sets + upload. `loading.tsx` + `error.tsx`. Breadcrumb. Playwright. | V3-003, V3-005 |
| V3-007 | Page Takeoff Jobs affaire | [E02](./V3-E02-hub-plans-metres.md) | L (3) | Back Front | Route `/dashboard/affaires/[projectId]/takeoff`. Join takeoff_jobs cross-versions. Filtre par version. Compteurs statuts. Adapte `TakeoffJobList`. `loading.tsx`. | V3-005 |
| V3-008 | Sidebar nav affaire-centric | [E02](./V3-E02-hub-plans-metres.md) | S (1) | Front | Lien "Metres plans" → `/dashboard/affaires/[projectId]/takeoff` (derniere affaire en localStorage). Bandeau deprecation `/dashboard/takeoff`. | V3-007 |
| V3-009 | Action rapide "Lancer un metre" | [E03](./V3-E03-workflow-metre-bridge.md) | S (1) | Front | Bouton dans `QuickActionsCard` → `TakeoffUploadForm` pre-configure (projectId, derniere version draft, Level A). Gate flag + plan set existant. | V3-005, V3-006 |
| V3-012 | UX Junior/Senior review | [E03](./V3-E03-workflow-metre-bridge.md) | M (2) | Front | Vue simplifiee junior (cartes, accepter/rejeter, append seul, barre progression). Vue expert complete. `useUiMode()`. Toggle temporaire. `next/dynamic` pour vue expert. | V3-007 |
| V3-013 | Plans dans flow import | [E03](./V3-E03-workflow-metre-bridge.md) | M (2) | Front | Etape optionnelle dans `UnifiedImportFlow` : `PlanFileUploadZone` entre Confirmation et Redirect. Gate flag. Chargement conditionnel. | V3-005, V3-006 |
| V3-014 | Auto-trigger metre | [E03](./V3-E03-workflow-metre-bridge.md) | M (2) | Back Front | Prompt apres upload → jobs Level A batch. Double gate flags. Preference localStorage versionnee. Server Action batch. | V3-006, V3-013 |

---

## Graphe de dependances

```
V3-001 (FS)
  ├── V3-004 (FS)
  └── V3-002 (FS)
        └── V3-003 (FS)
              ├── V3-005 (FS)
              │     ├── V3-006 (FE)
              │     │     ├── V3-009 (FE)
              │     │     ├── V3-013 (FE) [P2]
              │     │     │     └── V3-014 (FE) [P2]
              │     │     └──────────────────────┐
              │     └── V3-007 (FE)              │
              │           ├── V3-008 (FE)        │
              │           ├── V3-010 (FS) ───────┘
              │           └── V3-012 (FE)
              └── V3-011 (FS)
```

> Les stories FS forment la colonne vertebrale (fondation + APIs + logique metier).
> Les stories FE se branchent une fois les APIs pretes (a partir de V3-005).

---

## Sprint Plan (sprints de 2 semaines)

### Sprint 1 — Fondation DB (E01)

> Objectif : migrer `plan_sets` vers project-scope. Zero impact UI.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS** | V3-001 (M) → V3-004 (S) + V3-002 (M) | 5 | Migration colonne + backfill + RLS project-scope |
| **FE** | Buffer V2 / prep | 0 | Pas de deps V3 disponibles encore |

**Livrable S1 :** `plan_sets.project_id` NOT NULL, RLS project-scope actives, donnees existantes backfillees.

> Note : V3-001 d'abord, puis V3-004 et V3-002 en parallele (les deux ne dependent que de V3-001).

---

### Sprint 2 — APIs + Hub Card

> Objectif : les APIs project-scoped sont pretes, le hub affaire affiche les plans.
> Prerequis : V3-001, V3-002, V3-004 livres en S1.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS** | V3-003 (M) + V3-005 (M) | 4 | Routes dual-mode + card PlansMetres dans hub |
| **FE** | V3-006 (L) | 3 | Page Plan Center (demarre une fois V3-005 livre, peut deborder en S3) |

**Livrable S2 :** APIs plan-sets acceptent `project_id`, card Plans & Metres visible dans le hub, page Plan Center en cours.

---

### Sprint 3 — Pages Affaire & Carry-over

> Objectif : les pages takeoff sont navigables, le carry-over versions fonctionne.
> Prerequis : V3-003, V3-005 livres en S2.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS** | V3-011 (M) + V3-010 (L, debut) | 5 | Table version_links + debut comparaison DPGF |
| **FE** | V3-007 (L) + V3-009 (S) + V3-008 (S) | 5 | Page Jobs + action rapide metre + sidebar nav |

**Livrable S3 :** Page Jobs operationnelle, lien sidebar, action rapide metre, carry-over versions, comparaison DPGF en cours.

> Note : V3-010 (FS) depend de V3-007 (FE). FS commence la logique back (`dpgf-compare.ts`, fetcher) pendant que FE livre V3-007, puis FS branche la vue une fois la page prete.

---

### Sprint 4 — Workflow Integration

> Objectif : integration complete du workflow metre dans le flow chiffreur.
> Prerequis : V3-007 et V3-006 livres.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS** | V3-010 (fin si debord S3) + buffer | 0-3 | Finalisation compare view + corrections |
| **FE** | V3-012 (M) + V3-013 (M) | 4 | UX Junior/Senior review + plans dans flow import |

**Livrable S4 :** Comparaison DPGF vs Takeoff complete, review simplifiee junior, etape plans dans import.

---

### Sprint 5 — P2 + Polish final

> Objectif : features P2 restantes, stabilisation, tests E2E.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS** | Buffer bugs/perf | 0 | Corrections + EXPLAIN sur requetes critiques |
| **FE** | V3-014 (M) + buffer | 2 | Auto-trigger metre + stabilisation + E2E |

**Livrable S5 :** Auto-trigger, zero regression, couverture Playwright complete.

---

## Complexite par story

| Story | Effort | Complexite technique | Risques |
|-------|--------|---------------------|---------|
| V3-001 | M | Faible — ALTER TABLE + index composite | Verification idempotence (`pg_attribute`) |
| V3-002 | M | Moyenne — OR logique policies + nouvelle fonction SQL | Predicates indexables, validation EXPLAIN |
| V3-003 | M | Moyenne — dual-mode API (project_id OU version_id) + backward compat | Schema Zod dual-mode, coherence client/server |
| V3-004 | S | Faible — UPDATE + ALTER NOT NULL + validation count | Backfill sur table potentiellement vide |
| V3-005 | M | Faible — fetcher parallelise + card RSC | Promise.all plan_sets/takeoff_jobs |
| V3-006 | L | **Elevee** — adaptation PlanCenter.tsx pour projectId, route dynamique + loading/error | Regression composant existant version-scoped |
| V3-007 | L | **Elevee** — join takeoff_jobs cross-versions via estimate_versions, filtres, compteurs | Performance SQL sur gros volumes de jobs |
| V3-008 | S | Faible — modification `build-nav-groups.tsx` + bandeau deprecation | — |
| V3-009 | S | Faible — bouton dans QuickActionsCard + dialog TakeoffUploadForm | Auto-resolve derniere version draft |
| V3-010 | L | **Elevee** — algorithme matching DPGF-takeoff + vue cote-a-cote + lien manuel | Calibrage seuils (5%/20%), UX matching interactif |
| V3-011 | M | Moyenne — migration + RLS + CRUD + enrichir TakeoffSourceBadge | RLS indexable sur nouvelle table, UNIQUE constraint |
| V3-012 | M | Moyenne — 2 vues conditionnelles + toggle + `next/dynamic` | Coherence apply wizard entre modes junior/senior |
| V3-013 | M | Faible — etape optionnelle dans stepper existant | Integration dans `UnifiedImportFlow` sans regression |
| V3-014 | M | Moyenne — batch creation + preference localStorage versionnee + double gate | Gestion preference localStorage cross-sessions |

---

## Chemin critique

Le chemin critique (plus longue chaine de dependances) est :

```
V3-001 → V3-002 → V3-003 → V3-005 → V3-006
  (S1)     (S1)     (S2)     (S2)    (S2-S3)
```

Cela signifie que **V3-001 est le goulot d'etranglement** : toute l'integration hub + pages en depend. Il doit etre livre en priorite absolue debut Sprint 1.

Second chemin critique (workflow) :

```
V3-005 → V3-007 → V3-010
  (S2)     (S3)    (S3-S4)
```

Troisieme chemin (P2) :

```
V3-006 → V3-013 → V3-014
 (S2-S3)   (S4)     (S5)
```

---

## Coordination inter-equipes

| Sprint | Handoff FS → FE | Notes |
|--------|-----------------|-------|
| S1 → S2 | V3-002 debloque V3-003 (meme equipe), mais FE attend V3-005 pour V3-006 | FE peut preparer les composants en local avec mock data |
| S2 → S3 | V3-005 debloque V3-006, V3-007, V3-009 | Moment cle : l'essentiel du travail FE demarre |
| S3 → S4 | V3-007 (FE) debloque V3-010 (FS) | Dependance croisee : FS attend FE |
| S4 → S5 | V3-013 (FE) debloque V3-014 (FE) | Pas de handoff inter-equipe |

---

## Regles de gestion

1. **Pas de merge sur `main` sans tests** — chaque PR doit passer Vitest + Playwright critique
2. **Review cross-equipe** — les stories DB/Back (FS) et les pages UI (FE) sont relues mutuellement
3. **Demo fin de sprint** — chaque equipe demontre ses stories en 15 min
4. **Buffer S5** — 1 sprint de marge pour bugs, perf, tests E2E complets, stabilisation
5. **Definition of Done** — cf. [V3 README](./README.md) section "Standards techniques"
6. **Handoff S2** — la livraison de V3-005 par FS debloque la majorite du travail FE ; si en retard, tout le plan glisse
7. **Dependance croisee S3** — V3-010 (FS) depend de V3-007 (FE) ; FS commence la partie back (fetcher, `dpgf-compare.ts`) sans attendre la page

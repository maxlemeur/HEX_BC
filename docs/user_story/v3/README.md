# User Stories v3 — TIMAX

## Contexte

La V3 comporte 2 tracks independants qui peuvent etre developpes en parallele :

| Track | Objectif | Epics | Stories |
|-------|----------|-------|---------|
| **Takeoff / Metre** | Integrer le module metre (IA Gemini) dans le flow affaire-centric | V3-E01 a E03 | 14 stories |
| **Approbation / Direction** | Workflow d'approbation, role director, portail client | V3-E04+ | A definir |

Les 2 tracks ne partagent **aucune table, route ou composant** — ils peuvent etre developpes
par des equipes differentes sans conflit.

### Prerequis V2

La V3 presuppose que les features V2 suivantes sont livrees :
- UX2-005 : Page liste affaires (`/dashboard/affaires`)
- UX2-006 : Hub affaire (`/dashboard/affaires/[projectId]`)
- UX2-009 : UnifiedImportFlow (flux import unifie)
- UX2-001 : Mode UI Simplifie/Expert (`useUiMode()`)

### Baseline technique V3

- Framework: `next@16.x` (App Router) + `react@19`
- Tests unitaires/integration: **Vitest**
- Tests e2e parcours critiques: **Playwright**

---

## Track 1 : Takeoff / Metre

### Probleme

Le module takeoff est **version-scoped** : `plan_sets` et `takeoff_jobs` sont rattaches a
`estimate_version_id`. Dans le workflow BTP reel :
- Les plans PDF appartiennent au **projet** (affaire), pas a une version
- Le chiffreur recoit les plans UNE FOIS et les reutilise sur V1, V2, V3
- Le metre est le chainon entre "ce que le client demande" (DPGF) et "ce que je mesure"

### Solution

Migrer `plan_sets` vers un scope projet, surfacer le takeoff dans le hub affaire, et creer
un pont DPGF ↔ Takeoff pour comparer quantites client vs quantites mesurees.

### Flow cible

```
1. Reception DPGF + plans du client
2. Import DPGF dans affaire (V2)
3. Upload plans PDF dans l'affaire (V3)          ← V3-006
4. Extraction IA des quantites (takeoff)          ← V3-007, V3-009
5. Comparaison DPGF vs Takeoff                    ← V3-010
6. Validation / ajustement dans l'editeur
7. Chiffrage (prix unitaires, marge)
8. Soumission pour envoi
```

---

## Index des epics — Track Takeoff

| Code | Nom | Priorite | Stories | Fichier |
|------|-----|----------|---------|---------|
| V3-E01 | Plans Project-Scoped | P0 | V3-001 a 004 | [V3-E01-plans-project-scope.md](./V3-E01-plans-project-scope.md) |
| V3-E02 | Hub Plans & Metres | P0-P1 | V3-005 a 008 | [V3-E02-hub-plans-metres.md](./V3-E02-hub-plans-metres.md) |
| V3-E03 | Workflow Metre Bridge | P1-P2 | V3-009 a 014 | [V3-E03-workflow-metre-bridge.md](./V3-E03-workflow-metre-bridge.md) |

**Total Track Takeoff : 14 stories** (6 P0, 6 P1, 2 P2) | [Plan d'implementation](./IMPLEMENTATION_PLAN.md)

---

## Index des epics — Track Approbation (placeholder)

| Code | Nom | Priorite | Stories | Fichier |
|------|-----|----------|---------|---------|
| V3-E04 | Role Director & Permissions | P0 | A definir | — |
| V3-E05 | Workflow Approbation | P0 | A definir | — |
| V3-E06 | Dashboard Direction | P1 | A definir | — |
| V3-E07 | Portail Client | P2 | A definir | — |

> Infrastructure deja construite : `estimate_rules`, `estimate_approvals`, `rules-engine.ts`,
> `gating.ts`, `/api/estimates/[versionId]/approve`. Stories a rediger.

---

## Etat d'avancement — Track Takeoff

| Story | Titre | Epic | Priorite | Effort | Couches | Etat |
|-------|-------|------|----------|--------|---------|------|
| V3-001 | Ajout project_id plan_sets | E01 | P0 | M | DB | A faire |
| V3-002 | RLS project-scope | E01 | P0 | M | DB | A faire |
| V3-003 | Data access project-scoped | E01 | P0 | M | Back | A faire |
| V3-004 | Backfill plan_sets | E01 | P0 | S | DB | A faire |
| V3-005 | Card Plans & Metres hub | E02 | P0 | M | Back Front | A faire |
| V3-006 | Page Plan Center affaire | E02 | P0 | L | Back Front | A faire |
| V3-007 | Page Takeoff Jobs affaire | E02 | P1 | L | Back Front | A faire |
| V3-008 | Sidebar nav affaire-centric | E02 | P1 | S | Front | A faire |
| V3-009 | Action rapide metre | E03 | P1 | S | Front | A faire |
| V3-010 | Comparaison DPGF vs Takeoff | E03 | P1 | L | Back Front | A faire |
| V3-011 | Carry-over versions | E03 | P1 | M | DB Back | A faire |
| V3-012 | UX Junior/Senior review | E03 | P1 | M | Front | A faire |
| V3-013 | Plans dans flow import | E03 | P2 | M | Front | A faire |
| V3-014 | Auto-trigger metre | E03 | P2 | M | Back Front | A faire |

---

## Totaux — Track Takeoff

- **Par effort :** 3 Small, 7 Medium, 4 Large
- **Par priorite :** 6 P0, 6 P1, 2 P2
- **Par couche :**
  - `[DB]` 5 stories — V3-001, 002, 004, 011 + index dans 001
  - `[Back]` 7 stories — V3-003, 005, 006, 007, 010, 011, 014
  - `[Front]` 10 stories — toutes sauf V3-001, 002, 003, 004

---

## Graphe de dependances

```
V3-001 (DB: project_id)
  ├── V3-004 (DB: backfill)
  └── V3-002 (DB: RLS)
        └── V3-003 (Back: data layer)
              ├── V3-005 (Hub: card plans)
              │     ├── V3-006 (Page: Plan Center)
              │     │     ├── V3-009 (Action: lancer metre)
              │     │     ├── V3-013 (Import: etape plans) [P2]
              │     │     │     └── V3-014 (Auto-trigger) [P2]
              │     │     └──────────────────────┐
              │     └── V3-007 (Page: Jobs)      │
              │           ├── V3-008 (Nav)       │
              │           ├── V3-010 (Compare DPGF)
              │           └── V3-012 (UX Junior/Senior)
              └── V3-011 (Carry-over versions)
```

**Chemin critique** : `V3-001 → V3-002 → V3-003 → V3-005 → V3-006`

---

## Coexistence des 2 tracks

| Aspect | Track Approbation | Track Takeoff |
|--------|-------------------|---------------|
| Tables DB | `estimate_approvals`, `profiles` (role director) | `plan_sets` (modif), `takeoff_version_links` (new) |
| Routes API | `/api/estimates/*/approve` | `/api/takeoff/*` |
| Hub affaire | Badge/section "Approbation" | Section "Plans & Metres" |
| Feature flags | `APPROVAL_WORKFLOW_ENABLED` | `TAKEOFF_MODULE_ENABLED` |
| Conflit | Aucun | Aucun |

---

## Strategie de migration plan_sets

1. **Phase 1** (V3-001) : Ajout `project_id` nullable → zero impact existant
2. **Phase 2** (V3-004) : Backfill depuis `estimate_versions.project_id` → NOT NULL
3. **Phase 3** (V3-003) : APIs dual-mode (acceptent `project_id` OU `estimate_version_id`)
4. **Phase 4** (V3-005/006) : Nouvelles pages utilisent `project_id` exclusivement
5. **V4 (futur)** : Drop `estimate_version_id` de `plan_sets`

Aucune suppression de donnees. Aucun changement de paths storage. Backward compat totale.

---

## Standards techniques

Les standards V2 s'appliquent (cf. [V2 README](../v2/README.md#standards-techniques-obligatoires-v2)),
avec les complements V3 suivants :

- Next.js (`next-best-practices`) :
  - Reads internes via Server Components / `*.server.ts`
  - Mutations UI via Server Actions (`"use server"`) avec auth + validation
  - `route.ts` reserve aux uploads binaires, webhooks, compat API externe
  - Routes dynamiques en `params: Promise<...>` + `await`
  - `loading.tsx` / `error.tsx` / `not-found.tsx` sur nouveaux segments metier
  - Next 16: nouveau code en `proxy.ts` / `proxyConfig` (legacy `middleware.ts` temporaire)
- Supabase/Postgres (`supabase-postgres-best-practices`) :
  - Index sur toutes les FK + index composites alignes aux filtres reels (`tenant_id` en prefixe)
  - RLS performante (`(select auth.uid())`, predicates indexables, `EXPLAIN` obligatoire sur P0/P1)
  - Migrations idempotentes (DO block + `pg_constraint`/`pg_attribute`), pas de SQL fragile
  - Ecritures bulk (batch insert / upsert) pour imports et creation jobs multiples
  - Transactions courtes pour limiter contention/locks
- React/Next perf (`vercel-react-best-practices`) :
  - `async-parallel`, `async-suspense-boundaries`
  - `bundle-dynamic-imports`, `bundle-conditional`
  - `server-auth-actions`, `server-cache-react`, `server-serialization`
  - `rerender-memo`, `rerender-derived-state-no-effect`, `rerender-functional-setstate`, `rerender-transitions`
  - `client-event-listeners`, `client-passive-event-listeners`, `client-localstorage-schema`

### Definition of done technique (minimum)

- Stories P0/P1: plan de requete valide (`EXPLAIN`) sur requetes critiques
- Stories UI P0/P1: au moins 1 verification perf explicite (waterfall, bundle ou rerender)
- Tests obligatoires avant merge :
  - `npm test` (Vitest)
  - `npm run e2e:rls` (RLS sensible)
  - `npm run e2e:pw:critical` (parcours UX critiques)

# User Stories v1 — Module Takeoff (Metre Assiste + Gemini)

## Contexte

Le module estimates est mature (~60 migrations, 15 epics, 65 tickets). Le module **Takeoff**
constitue la v1 de l'integration IA : extraction et normalisation de donnees structurees
depuis CSV/Excel/PDF via Gemini AI, avec review humaine obligatoire avant application au devis.

Le PRD definit **3 niveaux** :

| Niveau | Description | Input | Output |
|--------|-------------|-------|--------|
| **A** | Import Normaliseur Universel | CSV / Excel | Items structures (designation, quantite, unite) |
| **B** | Extraction PDF Schedules | PDF (tableaux, nomenclatures) | Tables extraites, groupees par page/set |
| **C** | Pre-estimation Plan Complet | PDF (plans architecturaux) | Items avec confidence score + evidence |

Et **4 phases de livraison** progressives (MVP → Niveau B + Async → Niveau C → Mapping).

---

## Glossaire des roles

| Role      | Code interne | Description                                                     |
|-----------|--------------|-----------------------------------------------------------------|
| Chiffreur | `engineer`   | Cree et edite les devis, lance des jobs takeoff, review et apply |
| Admin     | `admin`      | Gere les tenants, feature flags, mapping rules, observabilite   |
| Client    | `viewer`     | Consulte les devis envoyes via le portail client (lecture seule) |

---

## Index des epics

| Code    | Nom                                   | Phase     | Priorite | Tickets      | Etat codebase (2026-02-26) | Fichier                                                                    |
|---------|---------------------------------------|-----------|----------|--------------|-----------------------------|----------------------------------------------------------------------------|
| TKF-E01 | Fondations Takeoff & Schema Canonique | 1 (MVP)   | P0       | TKF-001 a 006 | Termine (fichier fini)      | [TKF-E01-fondations-schema.md](./TKF-E01-fondations-schema.md)            |
| TKF-E02 | Niveau A : Import Normaliseur Universel | 1 (MVP) | P0       | TKF-007 a 013 | Termine (fichier fini)      | [TKF-E02-niveau-a-import.md](./TKF-E02-niveau-a-import.md)                |
| TKF-E03 | Provenance & Tracabilite              | 1 (MVP)   | P1       | TKF-014 a 016 | Termine (fichier fini)      | [TKF-E03-provenance-tracabilite.md](./TKF-E03-provenance-tracabilite.md)  |
| TKF-E04 | Niveau B : Extraction PDF Schedules   | 2         | P1       | TKF-017 a 021 | Termine (fichier fini)      | [TKF-E04-niveau-b-pdf-tables.md](./TKF-E04-niveau-b-pdf-tables.md)        |
| TKF-E05 | Niveau C : Pre-estimation Plan Complet| 3         | P1       | TKF-022 a 025 | Termine (fichier fini)      | [TKF-E05-niveau-c-pre-estimation.md](./TKF-E05-niveau-c-pre-estimation.md)|
| TKF-E06 | Job Async & Resilience                | 2         | P1       | TKF-026 a 028 | Termine (fichier fini)      | [TKF-E06-job-async-resilience.md](./TKF-E06-job-async-resilience.md)      |
| TKF-E07 | Mapping Rules & Revisions (optionnel) | 4         | P2       | TKF-029 a 032 | Termine (fichier fini)      | [TKF-E07-mapping-rules-revisions.md](./TKF-E07-mapping-rules-revisions.md)|

**Total : 32 tickets**

---

## Etat d'avancement tickets TKF-* (codebase au 2026-02-26)

| Ticket | Etat |
|---|---|
| TKF-001 | Fini |
| TKF-002 | Fini |
| TKF-003 | Fini |
| TKF-004 | Fini |
| TKF-005 | Fini |
| TKF-006 | Fini |
| TKF-007 | Fini |
| TKF-008 | Fini |
| TKF-009 | Fini |
| TKF-010 | Fini |
| TKF-011 | Fini |
| TKF-012 | Fini |
| TKF-013 | Fini |
| TKF-014 | Fini |
| TKF-015 | Fini |
| TKF-016 | Fini |
| TKF-017 | Fini |
| TKF-018 | Fini |
| TKF-019 | Fini |
| TKF-020 | Fini |
| TKF-021 | Fini |
| TKF-022 | Fini |
| TKF-023 | Fini |
| TKF-024 | Fini |
| TKF-025 | Fini |
| TKF-026 | Fini |
| TKF-027 | Fini |
| TKF-028 | Fini |
| TKF-029 | Fini |
| TKF-030 | Fini |
| TKF-031 | Fini |
| TKF-032 | Fini |

Resume:
- Fini: 32/32
- Partiel: 0/32
- A faire: 0/32

---

## Cadre QA commun (normalise)

Pour fermer un ticket Takeoff, les points suivants sont obligatoires:

- Contrats API documentes dans OpenAPI (si ticket API) et passage `validate-openapi`.
- Verification tenant/RLS explicite (DB + API) et absence de fuite cross-tenant.
- Gestion d'erreurs normalisee (`TakeoffError` + codes HTTP attendus).
- Observabilite minimale: logs structures et metriques si ticket de traitement async/IA.
- Tests adaptes au ticket:
  - unitaires pour logique pure (schemas, chunking, mapping, diff)
  - integration pour routes/process/apply
  - UI pour parcours critiques.

---

## Sequencing normalise (tickets parallelisables)

Les dependances detaillees par ticket dans les epics font foi. La planification ci-dessous
donne les vagues de travail parallelisables.

| Vague | Tickets (parallelisables dans la vague) | Focus |
|---|---|---|
| V1 | TKF-001, TKF-002, TKF-005 | Socle DB + schema + feature flag |
| V2 | TKF-003, TKF-004, TKF-014, TKF-015, TKF-017, TKF-029 | Gemini core + provenance + plans + mapping table |
| V3 | TKF-006, TKF-007, TKF-018, TKF-030 | Errors + create job + API plans + UI mapping |
| V4 | TKF-008, TKF-010, TKF-019, TKF-020, TKF-023 | Process A/B + upload/plan center + chunking |
| V5 | TKF-009, TKF-021, TKF-022, TKF-026 | CRUD jobs + review B + process C + async edge |
| V6 | TKF-011, TKF-012, TKF-024, TKF-027, TKF-028, TKF-032 | Monitor/review/stats/diff |
| V7 | TKF-013, TKF-016 | Apply wizard + badge provenance |
| V8 | TKF-025, TKF-031 | Guard apply C + apply avec mapping |

---

## Decoupage 4 equipes (type principal)

| Equipe | Type principal | Tickets |
|---|---|---|
| Equipe 1 — Data/RLS | DB + Back | TKF-001, TKF-014, TKF-017, TKF-018, TKF-029 |
| Equipe 2 — Gemini Core | Back | TKF-002, TKF-003, TKF-004, TKF-006, TKF-008, TKF-020, TKF-022, TKF-023, TKF-031 |
| Equipe 3 — Produit UI | Front + Back integration | TKF-005, TKF-010, TKF-011, TKF-012, TKF-016, TKF-019, TKF-021, TKF-024, TKF-030 |
| Equipe 4 — API/Async/Ops | Back (+ Front dashboard) | TKF-007, TKF-009, TKF-013, TKF-015, TKF-025, TKF-026, TKF-027, TKF-028, TKF-032 |

---

## Fichiers critiques a reutiliser

| Fichier existant | Usage dans Takeoff |
|---|---|
| `src/lib/estimates/server.ts` | `getAuthenticatedContext()`, `createEstimateItem()`, `assertDraftStatus()`, `bulkUpdateEstimateItems()`, `insertAssemblyIntoVersion()` pour Apply |
| `src/lib/estimates/schemas.ts` | Pattern Zod : validation, discriminatedUnion, preprocess, superRefine |
| `src/lib/estimates/errors.ts` | `ApiError`, `ok()`, `badRequest()`, `toErrorResponse()` — reutilise directement |
| `src/lib/estimates/batch.ts` | Pattern bulk operations atomiques |
| `src/lib/estimate-calculations.ts` | `computeEstimateTotals()` pour recalcul apres Apply |
| `src/lib/file-validation.ts` | `validateFileForUpload()` a etendre pour PDF/plans |
| `src/lib/feature-flags.ts` | `getFeatureFlagValueForTenant()` pour toggle takeoff |
| `src/lib/supabase/server.ts` | `createSupabaseServerClient()` |
| `docs/old_gemini_chiffrage/` | Reference SDK `@google/genai`, prompts, schemas Gemini, TakeoffModule UI |

---

## Arborescence cible

```
src/lib/takeoff/
  schemas.ts          # Zod TakeoffExchange + types
  types.ts            # Types TS communs
  errors.ts           # Errors + types communs Takeoff
  feature-flags.ts    # Feature flag TAKEOFF_MODULE_ENABLED
  gemini-client.ts    # Wrapper SDK Gemini server-side
  prompts.ts          # Prompts metier versiones A/B/C
  processor.ts        # Traitement job (normalisation Gemini -> Zod -> DB)
  server.ts           # Fonctions serveur Takeoff
  client.ts           # Client API wrappers
  chunking.ts         # Chunking PDF multi-pages
  guards.ts           # Guards (verified obligatoire, etc.)
  mapping-engine.ts   # Moteur mapping rules
  diff.ts             # Revision delta / comparaison
  stats.ts            # Metriques jobs

src/app/api/takeoff/
  jobs/route.ts                           # POST create job + GET list
  jobs/[jobId]/route.ts                   # GET job details
  jobs/[jobId]/process/route.ts           # POST process job
  jobs/[jobId]/retry/route.ts             # POST retry job
  jobs/[jobId]/cancel/route.ts            # POST cancel job
  jobs/[jobId]/apply/route.ts             # POST apply results
  jobs/[jobId]/items/route.ts             # GET/PATCH items
  jobs/[jobId]/items/[itemId]/verify/route.ts  # POST verify item
  jobs/[jobId]/compare/route.ts           # GET compare revisions
  jobs/[jobId]/preview-conversion/route.ts     # POST preview conversion
  mapping-rules/route.ts                  # GET/POST mapping rules
  mapping-rules/[ruleId]/route.ts         # PATCH/DELETE rule
  stats/route.ts                          # GET stats dashboard

src/app/dashboard/estimates/[versionId]/takeoff/
  page.tsx              # Job list
  new/page.tsx          # Upload + lancement
  [jobId]/page.tsx      # Job monitor
  [jobId]/review/page.tsx  # Review table

src/app/dashboard/estimates/[versionId]/plans/
  page.tsx              # Plan Center

src/components/takeoff/
  TakeoffUploadForm.tsx       # Upload drag&drop + choix niveau
  TakeoffJobMonitor.tsx       # Polling status temps reel
  TakeoffJobList.tsx          # Liste des jobs par projet
  TakeoffReviewTable.tsx      # Review items editables (Niveau A)
  TakeoffTableView.tsx        # Vue tables extraites (Niveau B)
  TakeoffReviewConfidence.tsx # Confidence bar (Niveau C)
  TakeoffEvidencePanel.tsx    # Evidence panel (Niveau C)
  TakeoffApplyWizard.tsx      # Apply multi-etapes
  TakeoffSourceBadge.tsx      # Badge "IA" + popover provenance
  PlanCenter.tsx              # Upload plans + organisation
  PlanFileCard.tsx            # Card fichier plan
  PlanSetManager.tsx          # Gestion sets de plans
  MappingRulesManager.tsx     # Admin mapping rules
  MappingRuleEditor.tsx       # Edition d'une regle
  TakeoffDiffView.tsx         # Vue diff revisions
  TakeoffStatsPanel.tsx       # Dashboard metriques

supabase/functions/process_takeoff_job/
  index.ts                    # Edge Function traitement async
```

---

## Conventions

Les conventions sont identiques au module estimates (voir [../README.md](../README.md#conventions)).

**Priorites :**

| Code | Signification |
|------|---------------|
| P0   | Bloquant — doit etre livre dans la phase courante |
| P1   | Important — necessaire pour la completude de la phase |
| P2   | Souhaitable — peut etre decale a la phase suivante sans impact critique |

**Effort :**

| Code | Signification |
|------|---------------|
| S    | Small — 1 a 2 jours dev, changements localises |
| M    | Medium — 3 a 5 jours dev, touche plusieurs fichiers/couches |
| L    | Large — 5+ jours dev, architecture nouvelle ou refactoring majeur |

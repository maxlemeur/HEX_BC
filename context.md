# Context: "Creer une affaire a partir de document jusqu'au remplissage automatique du chiffrage"

## 1. Scope

This repository contains several overlapping ways to go from source documents to an estimate.

The current canonical path is:

1. `affaire` hub and intake
2. document classification + brief generation
3. DPGF import + mapping + estimate version creation
4. optional plans sync
5. takeoff job creation from plan set
6. review + apply takeoff results into estimate
7. optional price suggestions to complete pricing

[Inference] There are also adjacent flows that can look similar but are not the same primary path:

- `version-zero` drafts: AI-assisted structural prefill from confirmed brief
- `generated-ouvrages`: AI generation of estimate items from text fragments
- legacy `estimate-first` takeoff pages

This file is optimized for LLM context and intentionally focuses on the contracts, routes, services, prompts, SQL RPCs, and UI surfaces that define the real flow.

## 2. Canonical current path

### 2.1 Affaire hub entry

- `src/app/dashboard/affaires/[projectId]/page.tsx`
- `src/components/affaires/AffaireHub.tsx`
- `src/lib/affaires/server.ts`

What these files establish:

- the current product entry point is the `affaire` hub
- the hub aggregates intake workspace, DPGF source, plan summary, takeoff, register, margin analysis, approval state, and version-zero summary
- this is the best top-level file pair to understand what the user actually sees

### 2.2 Intake: raw documents -> classified dossier -> brief

- `src/lib/affaires/intake.ts`
- `src/lib/affaires/intake-server.ts`
- `src/app/api/affaires/[projectId]/intake/files/route.ts`
- `src/app/dashboard/affaires/_actions/intake.ts`
- `src/components/affaires/IntakeWorkspace.tsx`
- `src/components/affaires/BriefDraftCard.tsx`

Key facts:

```ts
// src/lib/affaires/intake.ts
export const AFFAIRE_INTAKE_BUCKET = "affaire-intake";
export const AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
```

Main document kinds in intake:

- `dpgf`
- `plans`
- `cctp`
- `bpu_dqe`
- `annexes`
- `emails`
- `a_classer`

AI contract in intake server:

```ts
// src/lib/affaires/intake-server.ts
const AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION = "est371_affaire_intake_v1";
const AFFAIRE_INTAKE_CLASSIFICATION_MODEL = "gemini-3-flash-preview";
const AFFAIRE_BRIEF_PROMPT_VERSION = "est372_affaire_brief_v1";
const AFFAIRE_BRIEF_MODEL = "gemini-3-flash-preview";
```

Important exported functions:

```ts
createAffaireIntakeUpload(...)
processAffaireIntakeUpload(uploadId)
fetchAffaireIntakeWorkspace(projectId)
confirmAffaireBrief({ projectId })
reclassifyAffaireDocument(...)
```

Important behavior:

- upload lands in `affaire-intake`
- processing is async
- AI classifies documents and generates a brief
- confirming the brief triggers downstream sync logic
- plans can be synced automatically toward takeoff

Embedded intake contract:

```ts
// Simplified from src/lib/affaires/intake.ts
const affaireIntakeDocumentKindSchema = z.enum([
  "dpgf",
  "plans",
  "cctp",
  "bpu_dqe",
  "annexes",
  "emails",
  "a_classer",
]);

const affaireIntakeUploadStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "partial_failure",
  "failed",
]);

const affaireIntakeClassificationStatusSchema = z.enum([
  "queued",
  "processing",
  "classified",
  "ambiguous",
  "failed",
]);

const affaireIntakeBriefStatusSchema = z.enum([
  "a_confirmer",
  "confirme",
]);

const affaireIntakeBriefDraftSchema = z.object({
  status: affaireIntakeBriefStatusSchema,
  summary: z.string().min(1).max(900),
  projectObject: z.string().min(1).max(400),
  scope: z.array(z.string()).max(12),
  lots: z.array(z.string()).max(20),
  receivedPieces: z.array(z.string()).max(20),
  assumptions: z.array(z.string()).max(12),
  vigilancePoints: z.array(z.string()).max(12),
  missingElements: z.array(z.string()).max(12),
  sources: z.array(affaireIntakeBriefSourceSchema).max(120),
  uploadId: z.string().uuid().nullable(),
  lastGeneratedAt: z.string().datetime().nullable(),
  confirmedAt: z.string().datetime().nullable(),
});
```

Operational meaning:

- intake is multi-document and multi-format
- one upload can produce many classified documents
- the brief is the normalized dossier summary
- the brief carries provenance back to source documents

### 2.3 DPGF import + mapping + estimate creation

- `src/lib/imports/server.ts`
- `src/app/api/imports/route.ts`
- `src/lib/mappings/server.ts`
- `src/app/api/mappings/route.ts`
- `src/lib/affaires/import-flow.ts`
- `src/lib/affaires/import-flow-server.ts`
- `src/app/dashboard/affaires/_actions/import-flow.ts`
- `src/app/dashboard/affaires/_actions/quick-create-affaire.ts`
- `src/components/affaires/UnifiedImportFlow.tsx`

Storage contract:

```ts
// src/lib/imports/server.ts
const DPGF_IMPORTS_BUCKET = "dpgf-imports";
```

Primary persisted entities:

- `dpgf_imports`
- `dpgf_rows_raw`
- `dpgf_mappings`
- `dpgf_rows_mapped`
- `mapping_templates`
- `mapping_memory`

Mapping capabilities exposed by the API:

```ts
// src/app/api/mappings/route.ts
preview
suggestions
validate
duplicates
create
save-template
```

Important mapping server exports:

```ts
// src/lib/mappings/server.ts
listMappings(...)
previewMapping(...)
suggestMapping(...)
validateMapping(...)
findDuplicates(...)
createMapping(...)
saveTemplate(...)
```

Embedded mapping contract:

```ts
// Simplified from src/lib/mappings/schemas.ts
const MAPPING_TARGET_FIELDS = [
  "hex_code",
  "designation",
  "quantity",
  "unit",
  "unit_price_ht",
  "total_ht",
  "category",
  "supply_type",
  "supplier_ref",
  "labor_hours",
  "h_mo_majoration",
  "notes",
] as const;

const REQUIRED_MAPPING_TARGET_FIELDS = [
  "hex_code",
  "designation",
];
```

Operational meaning:

- imported rows are not estimate-ready before mapping
- the minimum viable mapping is `hex_code` + `designation`
- quantity, unit and price columns improve downstream estimate creation

Estimate creation contracts:

```ts
// src/app/dashboard/affaires/_actions/import-flow.ts
rpc("create_estimate_version_from_import_lines", ...)

// src/app/dashboard/affaires/_actions/quick-create-affaire.ts
rpc("create_affaire_from_import_lines", ...)
```

Behavior split:

- `quickCreateAffaire(...)` = fast path to create affair + first estimate version from import
- `confirmUnifiedImportFlow(...)` = add or rebuild a version from an import in an existing affair

Embedded SQL contract for affair creation from import:

```sql
create or replace function public.create_affaire_from_import_lines(
  p_import_id uuid,
  p_project_name text,
  p_project_client text default null,
  p_project_reference text default null,
  p_version_title text default null,
  p_section_title text default null,
  p_lines jsonb default '[]'::jsonb
)
returns table (
  project_id uuid,
  version_id uuid,
  section_id uuid,
  inserted_count integer,
  total_ht_cents integer,
  total_tax_cents integer,
  total_ttc_cents integer
)
```

Embedded SQL contract for adding a new version from import:

```sql
create or replace function public.create_estimate_version_from_import_lines(
  p_project_id uuid,
  p_import_id uuid,
  p_version_title text,
  p_section_title text,
  p_lines jsonb
)
returns table (
  version_id uuid,
  section_id uuid,
  inserted_count integer,
  total_ht_cents integer,
  total_tax_cents integer,
  total_ttc_cents integer
)
```

Operational meaning:

- both RPCs first create a `section` item
- then they insert estimate `line` items under that section
- one path creates the affair, the other only creates a new estimate version

Important caveat:

```ts
// src/app/dashboard/affaires/_actions/import-flow.ts
console.warn("takeoff carry-over skipped for import flow", ...)
```

This means carry-over of takeoff links between versions is best-effort, not guaranteed end-to-end.

### 2.4 Plans: classified documents -> plan sets

- `src/lib/affaires/intake-plan-sync.ts`
- `src/lib/takeoff/plans.ts`
- `src/components/affaires/PlansStep.tsx`
- `src/components/takeoff/TakeoffLaunchPrompt.tsx`
- `src/components/affaires/LaunchMetreDialog.tsx`

Key fact:

```ts
// src/lib/takeoff/plans.ts
export const PLAN_FILES_BUCKET = "plan-files";
```

Important plan APIs:

```ts
listPlanSets(...)
createPlanSet(...)
listPlanFiles(...)
createPlanFile(...)
```

Important scope detail:

- `plans.ts` supports both `project_id` and `estimate_version_id`
- [Inference] this is a compatibility layer while the canonical product flow is moving toward project-scoped plan sets

### 2.5 Takeoff: plan set -> AI extraction -> review -> apply

- `src/app/dashboard/affaires/_actions/takeoff.ts`
- `src/app/dashboard/affaires/[projectId]/takeoff/page.tsx`
- `src/components/takeoff/TakeoffActivityCenter.tsx`
- `src/app/dashboard/affaires/[projectId]/takeoff/[jobId]/review/page.tsx`
- `src/components/takeoff/TakeoffReviewPage.tsx`
- `src/components/takeoff/TakeoffApplyWizard.tsx`
- `src/lib/takeoff/document-classifier.ts`
- `src/lib/takeoff/schemas.ts`
- `src/lib/takeoff/prompts.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/takeoff/processor.ts`
- `supabase/functions/process_takeoff_job/index.ts`

Prompt versions and models:

```ts
// src/lib/takeoff/prompts.ts
export const TAKEOFF_PROMPT_VERSION_BY_LEVEL = {
  A: "takeoff-a-v1",
  B: "takeoff-b-v1",
  C: "takeoff-c-v1",
} as const;
```

Observed Gemini model matrix in prompts:

- level A uses `gemini-3-flash-preview`
- level B uses `gemini-3.1-pro-preview`
- level C uses `gemini-3.1-pro-preview`

Core server operations:

```ts
// src/lib/takeoff/server.ts
fetchDpgfTakeoffComparison(...)
requestTakeoffPriceSuggestion(...)
saveTakeoffDpgfManualLink(...)
saveTakeoffReviewDecision(...)
applyTakeoffJob(...)
createTakeoffJobFromFormData(...)
createTakeoffJobFromPlanSet(...)
```

Interpretation:

- `createTakeoffJobFromPlanSet(...)` is the current affaire-first path
- `createTakeoffJobFromFormData(...)` is a legacy/parallel upload path
- `applyTakeoffJob(...)` is the write-side endpoint that materializes reviewed extraction into estimate items

Embedded takeoff exchange contract:

```ts
// Simplified from src/lib/takeoff/schemas.ts
const TakeoffItemSchema = z.object({
  designation: z.string().min(1).max(500),
  quantity: z.number().gt(0),
  unit: z.string().min(1).max(64),
  category: z.string().nullable().optional(),
  source_page: z.number().int().min(1).optional(),
  source_file: z.string().max(255).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().max(2000).optional(),
});

const TakeoffMetadataSchema = z.object({
  level: z.enum(["A", "B", "C"]),
  prompt_version: z.string().max(64),
  file_type: z.string().max(64),
  schema_version: z.string().max(32),
});

const TakeoffExchangeSchema = z.object({
  items: z.array(TakeoffItemSchema),
  warnings: z.array(TakeoffWarningSchema),
  tables: z.array(TakeoffTableSchema).optional(),
  metadata: TakeoffMetadataSchema,
  confidence: z.number().min(0).max(1).optional(),
});
```

Important level-specific rules encoded by the schema:

- level `B` requires extracted `tables`
- level `C` requires global confidence
- level `C` also requires per-item `confidence`, `source_page`, and `evidence`

Embedded SQL contract for applying takeoff:

```sql
create or replace function public.apply_takeoff_job(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid default null
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text
)
```

Operational meaning:

- accepted strategies are `append`, `replace`, `merge`
- the job must be `completed`
- the target estimate version must still be `draft`
- applied takeoff lines are inserted with `source_provider = 'takeoff'`
- initial applied prices are zero, then pricing is completed later

Takeoff review/apply boundaries:

- `src/app/api/takeoff/jobs/route.ts`
- `src/app/api/takeoff/jobs/[jobId]/apply/route.ts`
- `src/app/api/takeoff/jobs/[jobId]/price-suggestions/route.ts`
- `src/app/api/takeoff/jobs/[jobId]/dpgf-compare/route.ts`

Useful supporting files if budget allows:

- `src/lib/takeoff/dpgf-compare.ts`
- `src/lib/takeoff/price-suggestions.ts`
- `src/lib/takeoff/guards.ts`
- `src/lib/takeoff/async-worker.ts`
- `src/lib/takeoff/edge-trigger.ts`
- `src/lib/takeoff/version-links.ts`

### 2.6 Price completion

- `src/lib/takeoff/price-suggestions.ts`
- `src/app/api/takeoff/jobs/[jobId]/price-suggestions/route.ts`
- `supabase/migrations/20260306235900_est392_takeoff_price_suggestions.sql`

This is the main "automatic pricing completion" layer after quantities/items already exist.

It is not the same thing as:

- DPGF import
- takeoff extraction
- version-zero structural prefill

## 3. Adjacent but non-canonical flows

### 3.1 Version zero drafts

- `src/lib/estimates/version-zero-drafts.ts`
- `src/app/api/estimates/[versionId]/version-zero-drafts/route.ts`
- `src/lib/estimates/structure-drafts.ts`
- `src/lib/estimates/schemas.ts`
- `supabase/migrations/20260307201500_est384_version_zero_drafts.sql`
- `supabase/migrations/20260307224500_est384_version_zero_materialize_rpc.sql`

Important exports:

```ts
// src/lib/estimates/version-zero-drafts.ts
fetchVersionZeroDraftSummary(...)
generateVersionZeroDraft(...)
materializeVersionZeroDraft(...)
```

Important caveat:

```ts
// src/lib/estimates/version-zero-drafts.ts
unit_price_ht_cents: 0
```

[Inference] This means V0 is mainly structural prefill and quantity prefill. It is not a complete pricing engine by itself.

Operational meaning:

- V0 is useful to bootstrap an empty draft from a confirmed brief
- V0 is not equivalent to takeoff apply
- V0 is not a fully priced estimate generation pipeline

### 3.2 Generated ouvrages

- `src/lib/estimates/generated-ouvrages.ts`
- `src/app/dashboard/affaires/_actions/generated-ouvrages.ts`
- `supabase/migrations/20260307110000_est381_generated_ouvrages.sql`
- `supabase/migrations/20260307173000_est383_generated_ouvrage_subdetails.sql`

[Inference] This is another AI-assisted filling strategy, parallel to V0 and separate from takeoff.

### 3.3 Legacy estimate-first takeoff

- `src/app/dashboard/estimates/[versionId]/takeoff/new/page.tsx`
- `src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/page.tsx`
- `src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/review/page.tsx`
- `src/components/takeoff/TakeoffUploadForm.tsx`
- `src/components/takeoff/TakeoffJobMonitor.tsx`
- `src/components/takeoff/TakeoffDeprecationBanner.tsx`

[Inference] Keep these for disambiguation, not as the primary flow.

## 4. Database contracts that matter

### Intake and brief

- `supabase/migrations/20260306210000_est371_affaire_intake.sql`
- `supabase/migrations/20260306224500_est372_affaire_brief.sql`
- `supabase/migrations/20260307000500_est373_affaire_register.sql`

Key logical entities:

- `affaire_intake_uploads`
- `affaire_intake_documents`
- `affaire_intake_events`
- `affaire_briefs`
- `affaire_brief_source_links`
- `affaire_register_entries`
- `affaire_register_events`

Minimal mental model:

- `uploads` group incoming files
- `documents` store per-file classification and extracted metadata
- `briefs` store the synthesized dossier
- `source_links` preserve provenance from brief blocks to source documents
- `register` stores assumptions, risks, and missing information after brief confirmation

### DPGF import and mapping

- `supabase/migrations/011_dpgf_import_tables_s3.sql`
- `supabase/migrations/012_mapping_tables_s4.sql`
- `supabase/migrations/20260305103000_ux2_011_quick_create_from_import.sql`
- `supabase/migrations/20260307113000_ux2_009_create_estimate_version_from_import_lines_section_defaults_fix.sql`

Important SQL contracts:

- `create_affaire_from_import_lines`
- `create_estimate_version_from_import_lines`

Source-of-truth note:

- read `20260307113000_ux2_009_create_estimate_version_from_import_lines_section_defaults_fix.sql`
- do not rely on the earlier `20260305_ux2_009_create_estimate_version_from_import_lines.sql` as the final contract

### Takeoff

- `supabase/migrations/20260224123000_tkf001_takeoff_schema.sql`
- `supabase/migrations/20260224203000_tkf017_takeoff_plans.sql`
- `supabase/migrations/20260305120000_v3_001_plan_sets_project_scope.sql`
- `supabase/migrations/20260305124000_v3_002_plan_sets_project_rls.sql`
- `supabase/migrations/20260305132000_v3_005_plan_sets_scope_consistency_fix.sql`
- `supabase/migrations/20260305134000_v3_006_plan_sets_scope_storage_compat.sql`
- `supabase/migrations/20260225133000_tkf013_takeoff_apply_rpc.sql`
- `supabase/migrations/20260306110000_v3_011_takeoff_version_links.sql`
- `supabase/migrations/20260306130000_v3_010_takeoff_dpgf_links.sql`
- `supabase/migrations/20260306153000_v3_010_takeoff_review_decisions_and_multi_links.sql`
- `supabase/migrations/20260306235900_est392_takeoff_price_suggestions.sql`

Key logical entities:

- `takeoff_jobs`
- `takeoff_results`
- `takeoff_items`
- `plan_sets`
- `plan_files`
- `takeoff_version_links`
- DPGF/takeoff link tables
- review decision tables
- price suggestion tables

Minimal mental model:

- `takeoff_jobs` track execution state
- `takeoff_results` store model outputs and processing metadata
- `takeoff_items` are the reviewable extracted business lines
- `plan_sets` and `plan_files` are the uploaded plan inventory
- DPGF/takeoff links and review decisions reconcile extracted output with estimate expectations
- price suggestion tables store explainable automatic pricing proposals

Important note:

- the product is in a transition from version-scoped plans to project-scoped plans
- multi-link review and DPGF comparison evolved over multiple migrations

## 5. High-signal files by function

### Best files for understanding the end-to-end feature quickly

1. `src/app/dashboard/affaires/[projectId]/page.tsx`
2. `src/components/affaires/AffaireHub.tsx`
3. `src/lib/affaires/intake-server.ts`
4. `src/lib/imports/server.ts`
5. `src/lib/mappings/server.ts`
6. `src/lib/affaires/import-flow.ts`
7. `src/lib/affaires/import-flow-server.ts`
8. `src/lib/affaires/intake-plan-sync.ts`
9. `src/lib/takeoff/plans.ts`
10. `src/lib/takeoff/schemas.ts`
11. `src/lib/takeoff/prompts.ts`
12. `src/lib/takeoff/processor.ts`
13. `src/lib/takeoff/server.ts`
14. `src/lib/takeoff/price-suggestions.ts`
15. the SQL migrations listed above

### UI files that directly participate in the main user journey

- `src/components/affaires/IntakeWorkspace.tsx`
- `src/components/affaires/BriefDraftCard.tsx`
- `src/components/affaires/UnifiedImportFlow.tsx`
- `src/components/affaires/PlansStep.tsx`
- `src/components/takeoff/TakeoffLaunchPrompt.tsx`
- `src/components/affaires/LaunchMetreDialog.tsx`
- `src/components/takeoff/TakeoffActivityCenter.tsx`
- `src/components/takeoff/TakeoffReviewPage.tsx`
- `src/components/takeoff/TakeoffApplyWizard.tsx`

### API boundaries worth exposing to the LLM

- `src/app/api/affaires/[projectId]/intake/files/route.ts`
- `src/app/api/imports/route.ts`
- `src/app/api/mappings/route.ts`
- `src/app/api/takeoff/jobs/route.ts`
- `src/app/api/takeoff/jobs/[jobId]/apply/route.ts`
- `src/app/api/takeoff/jobs/[jobId]/price-suggestions/route.ts`
- `src/app/api/takeoff/jobs/[jobId]/dpgf-compare/route.ts`
- `src/app/api/affaires/[projectId]/dpgf-source/route.ts`
- `src/app/api/estimates/[versionId]/import-linked-dpgf/route.ts`

## 6. Important pitfalls for the receiving LLM

1. Do not collapse `intake`, `import DPGF`, `takeoff`, `version-zero`, and `generated-ouvrages` into a single mechanism. They are separate flows.
2. The canonical UX is `affaire-first`, not the old `estimate-first` takeoff flow.
3. `version-zero` does not equal final priced estimate. It can materialize lines with `unit_price_ht_cents = 0`.
4. `quick-create-affaire` and `confirmUnifiedImportFlow` are two different write paths for creation from import.
5. `plans.ts` contains compatibility for both `project_id` and `estimate_version_id`. Prefer project-scoped interpretation when reasoning about the current product.
6. Use migrations as the primary DB truth. `src/types/database.ts` and `supabase/schema.sql` are useful snapshots but not the best source for migration order or current intent.
7. There are explicit warnings about skipped takeoff carry-over between versions, so do not assume perfect propagation.
8. There are two distinct materialization mechanisms:
   - DPGF import materializes estimate lines from mapped tabular rows
   - takeoff apply materializes estimate lines from reviewed extracted plan quantities
9. "Automatic estimate filling" is not one single service. Distinguish:
   - structure import from DPGF
   - quantity extraction from plans
   - review/apply into estimate items
   - price completion via suggestions

## 7. Minimal bundle if token budget gets tight

If the receiving LLM cannot ingest everything, keep at least:

- `src/app/dashboard/affaires/[projectId]/page.tsx`
- `src/components/affaires/AffaireHub.tsx`
- `src/lib/affaires/intake.ts`
- `src/lib/affaires/intake-server.ts`
- `src/lib/imports/server.ts`
- `src/lib/mappings/server.ts`
- `src/lib/affaires/import-flow.ts`
- `src/lib/affaires/import-flow-server.ts`
- `src/lib/affaires/intake-plan-sync.ts`
- `src/lib/takeoff/plans.ts`
- `src/lib/takeoff/schemas.ts`
- `src/lib/takeoff/prompts.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/takeoff/processor.ts`
- `src/lib/takeoff/price-suggestions.ts`
- `supabase/functions/process_takeoff_job/index.ts`
- the intake/import/takeoff SQL migrations

## 8. Final interpretation

The strongest end-to-end interpretation of the feature in the current codebase is:

- documents enter the affair via intake
- tabular pricing documents enter via DPGF import and mapping
- plans enter takeoff via plan sets
- takeoff produces extractable quantities/items
- reviewed takeoff results are applied to estimate items
- price suggestions help complete pricing

[Inference] `version-zero` and `generated-ouvrages` should be treated as neighboring AI-assist features, not as the single canonical implementation of "document -> chiffrage auto".

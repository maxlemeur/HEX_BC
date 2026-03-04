# UX2-011 FS-A -> UX Frontend Handoff (Backend Contract + UI Implementation Guide)

## Scope FS-A
FS-A delivered backend for UX2-011 and **did not implement UI components**.

FS-A scope completed:
- Quick creation of an affaire with optional import-based estimate creation.
- Support for affaires without versions in `/dashboard/affaires` list and counters.
- Support for advanced wizard flow on an existing `projectId` (blank + template paths).

UX frontend team scope (this handoff):
- Implement UI and interaction flows consuming the backend contracts below.

## Backend delivered (contractual)

### 1) SQL migrations delivered
- `supabase/migrations/20260305103000_ux2_011_quick_create_from_import.sql`
- `supabase/migrations/20260305104000_ux2_011_affaires_include_projects_without_versions.sql`
- `supabase/migrations/20260305105000_ux2_011_instantiate_template_into_existing_project.sql`

### 2) New/updated RPC contracts

`public.create_affaire_from_import_lines(...)`
- Creates project + links import + creates V1 + section + lines in one DB transaction.
- Returns:
  - `project_id`
  - `version_id`
  - `section_id`
  - `inserted_count`
  - totals (`total_ht_cents`, `total_tax_cents`, `total_ttc_cents`)

`public.instantiate_estimate_template_into_project(...)`
- Instantiates a template as version `N+1` into an existing project.
- Returns: `project_id`, `version_id`.

`public.list_affaires_page(...)`
- Includes projects **with and without** estimate versions.
- Returns new field: `has_current_version`.
- `current_version_*` fields are nullable.
- `current_updated_at` is always non-null (fallback to `estimate_projects.updated_at`).

`public.get_affaires_counters(...)`
- No-version projects are counted as `draft` by product decision.

### 3) API contract updates

`POST /api/estimates`
- Existing mode preserved (create new project + V1).
- New mode: existing project via `project_id` / `projectId`.
- Payload accepts:
```json
{
  "project_id": "<uuid>",
  "project": {
    "name": "<string>",
    "reference": null,
    "client_name": null,
    "notes": null
  },
  "version": { "...": "..." }
}
```
- Rule: at least one of `project` or `project_id` must be provided.
- If `project_id` is provided, backend creates version `N+1` in that project.

`POST /api/estimates/templates/:templateId/instantiate`
- Existing mode preserved: `project_name`/`projectName` creates new project.
- New mode: `project_id`/`projectId` instantiates into existing project.
- Rule: at least one of `project_name` or `project_id` must be provided.

### 4) New Server Action

`quickCreateAffaire(input)`
- File: `src/app/dashboard/affaires/_actions/quick-create-affaire.ts`
- Allowed roles: `admin | engineer`.
- Branches:
  - No import: creates empty `estimate_projects`, redirects to affaire hub.
  - With import: validates import access, optional mapping creation, normalizes mapped rows, calls atomic RPC, redirects to estimate editor.
- Redirects:
  - No import: `/dashboard/affaires/{projectId}?created=1`
  - With import: `/dashboard/estimates/{versionId}/edit?...`

Redirect query params for import branch:
- `fromQuickCreate=1`
- `projectId`
- `importId`
- `insertedRows`
- `skippedRows`
- `mappingId`

## Data contract for `/dashboard/affaires`

`AffaireListItem` backend shape:
```ts
{
  projectId: string;
  projectName: string;
  projectReference: string | null;
  projectClient: string | null;
  versionCount: number;
  hasCurrentVersion: boolean;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  currentStatus: "draft" | "sent" | "accepted" | "archived" | null;
  currentTotalHtCents: number | null;
  currentUpdatedAt: string; // always non-null (cursor-safe)
  acceptedVersionId: string | null;
  acceptedVersionNumber: number | null;
}
```

Product rule implemented:
- No current version is treated as `draft` for filters/counters.

## UX Frontend implementation (to build by UX team)

### A) Replace `+ Nouvelle affaire` CTA in `AffairesPageClient.tsx`
- Replace direct navigation behavior with opening `QuickCreateAffaireDialog`.
- Keep keyboard activation and visible focus styles.
- Keep existing permissions/visibility rules for CTA.

### B) Build `QuickCreateAffaireDialog` (new UI component)
Required modes:
- `Simplifie`: create affaire without import.
- `Expert`: create affaire + optional import path (import + mapping + version title/section title).

Required fields/states:
- Project name (required).
- Optional: client, reference.
- Optional import selection in expert mode.
- Optional mapping definition in expert mode.
- Optional version/section titles for import-based creation.
- States: idle, loading, server error, success/redirect handoff.

Validation contract:
- Disable submit while loading.
- Display textual validation messages (not color-only).
- Keep submit disabled when required data is missing.

### C) Connect dialog confirmation to `quickCreateAffaire`
- Use server action call on submit.
- Do not double-navigate client-side on success; server action redirects.
- On server error, keep dialog open and show inline error block.
- Keep optimistic UX only for loading state; backend remains source of truth.

### D) Adapt list renderers for `hasCurrentVersion=false`
Files:
- `src/components/affaires/AffairesCardList.tsx`
- `src/components/affaires/AffairesDenseTable.tsx`

Required behavior when `hasCurrentVersion=false`:
- Main navigation target: `/dashboard/affaires/{projectId}` (hub), not estimate page.
- Status display: explicit text `Aucun chiffrage`.
- Version badge: no fake version number.
- Amount column: empty placeholder (`—`) instead of numeric value.
- Keep `currentUpdatedAt` as display date fallback.

### E) Adapt advanced wizard for existing project
File:
- `src/components/estimates/EstimateCreationWizard.tsx`

Required behavior:
- Read `projectId` from URL query (`/dashboard/estimates/new?projectId=...`).
- If `projectId` exists:
  - Blank path uses `createEstimate({ projectId, ... })`.
  - Template path uses `instantiateEstimateFromTemplate(templateId, { projectId, ... })`.
  - Must **not** recreate a new project.
- Preserve existing behavior when no `projectId` is present.

### F) Update hub CTA for first version creation
File:
- `src/components/affaires/AffaireHub.tsx`

Required behavior:
- CTA `Créer une première version` points to:
  - `/dashboard/estimates/new?projectId={projectId}`
- This must activate the existing-project wizard behavior in item E.

### G) Accessibility requirements (mandatory)
- Dialogs: proper `role="dialog"`, labelled title, focus trap, Escape support.
- Buttons/inputs/selects: explicit labels or `aria-label`.
- Errors/success: textual message + `aria-live` where relevant.
- Do not encode status only via color.
- Mobile/tablet responsive behavior for dialog and list/table representations.

## UX QA checklist (frontend)
- Opening quick-create dialog from affaires page works with mouse + keyboard.
- Simplified mode creates empty affaire and lands on hub.
- Expert mode with import creates affaire + V1 and lands in editor.
- Affaires list rows without versions render with `Aucun chiffrage` and hub navigation.
- Wizard with `projectId` creates new version in existing project for blank/template paths.
- Hub CTA to first version routes to wizard with `projectId` query.
- ARIA/focus/error messaging validated on desktop and mobile breakpoints.

## Notes for coordinated release
- Backend contract is intentionally nullable for current version fields.
- Frontend adaptation is required before release to production.
- Current `typecheck` impact is expected until UX list components consume nullable contract.

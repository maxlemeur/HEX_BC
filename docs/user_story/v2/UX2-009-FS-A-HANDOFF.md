# UX2-009 FS-A -> UX Frontend Handoff (Backend Contract)

## Scope FS-A
FS-A delivered backend-only foundation for `UnifiedImportFlow` confirmation:

- Server Action `confirmUnifiedImportFlow(...)`.
- Parsing/normalization module for mapped rows.
- SQL RPC for atomic version creation from mapped lines.
- Imports API filter by project (`GET /api/imports?project_id=...`).

FS-A does **not** implement `UnifiedImportFlow` UI in this batch.

## Delivered backend surfaces

### 1) Server Action
File: `src/app/dashboard/affaires/_actions/import-flow.ts`

```ts
confirmUnifiedImportFlow(input: {
  importId: string;
  projectId?: string | null;
  mapping?: Record<string, string | null>;
  createEstimate: boolean;
  versionTitle?: string | null;
  sectionTitle?: string | null;
}): Promise<{
  mode: "mapping_only" | "version_created";
  importId: string;
  projectId: string | null;
  mappingId: string | null;
  versionId: string | null;
  redirectTo: string | null;
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    insertedRows: number;
    skippedRows: number;
  };
}>
```

Behavior:
- Rejects `createEstimate=true` when `projectId` is missing.
- Validates tenant ownership/admin scope for import + project.
- Rejects import relink when import already belongs to another project.
- Optional `mapping` triggers `createMapping(...)`.
- Parses mapped rows to valid/invalid sets.
- Creates estimate version through RPC when `createEstimate=true`.

### 2) Parsing/validation module
File: `src/lib/affaires/import-flow.ts`

Main exports:
- `parseLocalizedNumber(...)` (FR/EN number parsing).
- `normalizeMappedRowsForEstimateCreation(...)`.
- `buildImportFlowStats(...)`.

Rules:
- Valid row requires:
  - non-empty title (`designation` fallback `reference/hex_code`)
  - `quantity > 0`
  - valid unit price (direct or derived from `total_ht / quantity`)
- Invalid rows are skipped for estimate creation.

### 3) SQL RPC
Migration:
`supabase/migrations/20260305_ux2_009_create_estimate_version_from_import_lines.sql`

Function:
```sql
public.create_estimate_version_from_import_lines(
  p_project_id uuid,
  p_import_id uuid,
  p_version_title text,
  p_section_title text,
  p_lines jsonb
) returns table (
  version_id uuid,
  section_id uuid,
  inserted_count int,
  total_ht_cents int,
  total_tax_cents int,
  total_ttc_cents int
)
```

Behavior:
- Checks tenant membership + owner/admin access.
- Requires import linked to target project.
- Creates `Vn+1` draft.
- Copies version pricing parameters from latest version when available.
- Creates one root section + inserts mapped valid lines as children.
- Updates version totals in same transaction.

### 4) Imports API filter
Files:
- `src/lib/imports/server.ts`
- `src/app/api/imports/route.ts`

Contract:
```http
GET /api/imports?project_id=<uuid>
```

Behavior:
- Invalid UUID -> `BAD_REQUEST`.
- Valid UUID -> list scoped imports filtered by `project_id`.

## UX frontend integration requirements

### Use in `UnifiedImportFlow` (UX team)
1. Upload step: use existing `useImportFlow`.
2. Mapping step: use `/api/mappings` + `ColumnMapper`.
3. Preview step: use `/api/mappings` preview + `DataPreview`.
4. Confirmation step: call `confirmUnifiedImportFlow`.

### Expected UX behavior
1. If result mode is `version_created`:
   - navigate to `redirectTo`.
2. If result mode is `mapping_only`:
   - stay on hub and show returned `stats`.
3. In UX2-009 simplified mode:
   - no confidence auto-skip (deferred to UX2-010).

## Shared validation scenarios
1. `projectId` absent + `createEstimate=false` -> `mapping_only`.
2. `projectId` absent + `createEstimate=true` -> error.
3. import already linked to another project -> error.
4. zero valid lines + `createEstimate=true` -> error.
5. valid mapped lines + `createEstimate=true` -> `version_created` with redirect.


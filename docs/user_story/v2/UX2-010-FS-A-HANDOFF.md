# UX2-010 FS-A -> UX Frontend Handoff (Backend Contract)

## Scope FS-A
FS-A delivered backend-only changes for confidence-based auto-mapping:

- DB migration for tenant-aware uniqueness on `mapping_memory`.
- Atomic bulk UPSERT function for `mapping_memory` updates.
- Extended `suggestions` response in mappings API.
- Scoring engine (template/memory/heuristic) + auto-validation eligibility.

FS-A does **not** implement UX/UI components in this batch.

## Delivered backend surfaces

### 1) DB migration
File: `supabase/migrations/20260305_ux2_010_mapping_memory_upsert.sql`

Includes:
- Unique key migration:
  - drop legacy: `mapping_memory_user_id_source_column_target_field_key`
  - add tenant-aware: `mapping_memory_tenant_user_source_target_key`
    on `(tenant_id, user_id, source_column, target_field)`
- Read index aligned with suggest query:
  - `mapping_memory_tenant_user_source_idx` on `(tenant_id, user_id, source_column)`
- New SQL function:
  - `public.upsert_mapping_memory_bulk(p_entries jsonb)`

### 2) SQL function contract
Function:
```sql
public.upsert_mapping_memory_bulk(p_entries jsonb)
returns table (
  tenant_id uuid,
  user_id uuid,
  source_column text,
  target_field text,
  usage_count integer,
  confidence numeric
)
```

Input payload shape (`p_entries`):
```json
[
  {
    "tenant_id": "<uuid>",
    "user_id": "<uuid>",
    "source_column": "Code article",
    "target_field": "hex_code"
  }
]
```

Behavior:
- Insert path:
  - `usage_count = 1`
  - `confidence = 0.6000`
- Conflict path (`tenant_id,user_id,source_column,target_field`):
  - `usage_count = usage_count + 1`
  - `confidence` increases progressively and is capped to `0.9800`
  - `last_used_at = now()`

### 3) Mappings API contract extension
Endpoint:
```http
POST /api/mappings
Content-Type: application/json

{
  "action": "suggestions",
  "import_id": "<uuid>"
}
```

Response now includes legacy fields + UX2-010 fields:

```ts
{
  suggestions: Record<string, MappingTargetField>;            // legacy
  source_columns: string[];                                   // legacy
  templates: Template[];                                      // legacy
  sample_values: Record<string, string[]>;                    // legacy

  confidence_by_source: Record<string, {
    target_field: MappingTargetField;
    score: number;                                            // [0..1]
    band: "high" | "medium" | "low";
    origin: "template" | "memory" | "heuristic";
    usage_count: number | null;
    memory_confidence: number | null;
  }>;

  template_exact_match: {
    id: string;
    name: string;
    supplier_name: string | null;
    score: number;                                            // always 1
  } | null;

  auto_validation: {
    can_auto_validate: boolean;
    threshold: number;                                        // 0.8
    required_fields: MappingTargetField[];
    missing_required_fields: MappingTargetField[];
    low_confidence_required_fields: MappingTargetField[];
  };
}
```

No request payload changes for:
- `action: "create"`
- `action: "save-template"`

### 4) Scoring rules (server-side)

Bands:
- `high`: `score > 0.80`
- `medium`: `0.50 <= score <= 0.80`
- `low`: `score < 0.50`

Priority:
1. exact template match
2. mapping memory
3. heuristic guess

Rules:
- exact template match: score `1.00`
- memory score:
  - `usage_signal = min(1, ln(usage_count + 1) / ln(6))`
  - `score = clamp(0.4 * confidence + 0.6 * usage_signal, 0, 1)`
- heuristic score: calibrated low-medium range (`0.45` to `0.58`)

Dedup policy:
- if multiple source columns map to the same target field,
  keep only the best candidate (score first, then source quality tie-breakers).

### 5) Auto-validation eligibility logic

`auto_validation.can_auto_validate = true` only if:
- all required fields are mapped (`hex_code`, `designation`), and
- each required-field mapping has `score > 0.80`.

## UX frontend integration requirements (to implement by UX team)

1. `ColumnMapper`:
- show confidence badge per source column from `confidence_by_source`.
- badge labels must include text (not color only):
  - Confiance elevee / moyenne / faible.

2. `UnifiedImportFlow` (mode simplifie):
- if `template_exact_match` is present, show:
  - "Mapping applique depuis le template {name}".
- if `auto_validation.can_auto_validate === true`,
  auto-pass Mapping -> Preview with info banner:
  - "Mapping automatique applique" + action "Modifier le mapping".

3. `MappingWizard` standalone:
- consume confidence metadata and show "auto-valide" state in simplified mode.
- **do not auto-submit** mapping; keep explicit click on "Enregistrer le mapping".

4. Accessibility:
- add ARIA labels for confidence badges and auto-validation banners.

## Shared validation scenarios

1. Exact template match
- `template_exact_match` non-null.
- required fields score `1.00`.
- `auto_validation.can_auto_validate = true`.

2. Memory + heuristic mix
- memory suggestions outrank heuristics.
- `confidence_by_source` populated for every selected suggestion.
- `auto_validation` false when a required field is <= 0.80.

3. Collision on same target
- only highest-confidence source is kept.

4. Mapping memory persistence
- save/create mapping path calls atomic SQL function once per batch.
- no duplicate row for `(tenant_id,user_id,source_column,target_field)`.

5. Backward compatibility
- legacy fields still returned: `suggestions`, `source_columns`, `templates`, `sample_values`.

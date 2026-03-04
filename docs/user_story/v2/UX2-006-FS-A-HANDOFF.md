# UX2-006 + UX2-007 FS-A Handoff (Backend Contract Only)

## Scope FS-A
FS-A delivered backend-first for Hub Affaire + DPGF linkage:
- `dpgf_imports.project_id` in DB with FK `ON DELETE SET NULL`, indexes, and RLS update.
- Import creation supports `projectId` at creation time (JSON + multipart).
- Manual relink server action for existing imports.
- Hub backend fetchers in `src/lib/affaires/server.ts`.

FS-A does **not** implement hub UI screens/components.

## Delivered backend surfaces

### 1) DB migration (UX2-007)
File: `supabase/migrations/20260305_ux2_007_link_dpgf_to_project.sql`

Includes:
- `alter table public.dpgf_imports add column project_id uuid null`
- FK `dpgf_imports_project_id_fkey -> estimate_projects(id) on delete set null`
- Partial composite index:
  - `(tenant_id, project_id, created_at desc) where project_id is not null`
- Partial FK index:
  - `(project_id) where project_id is not null`
- Policy `Users can manage own dpgf imports` updated:
  - keep owner/admin access rules
  - enforce linked project ownership/admin same tenant when `project_id is not null`
  - preserve backward compatibility for historic rows with `project_id is null`

### 2) Imports API contract
File: `src/lib/imports/server.ts`

`POST /api/imports` now accepts `projectId`:
- JSON mode (`application/json`):
  - payload may include `projectId` (or `project_id`)
- Multipart mode (`multipart/form-data`):
  - form-data may include `projectId` (or `project_id`)

Validation:
- `projectId` optional
- if present, must be UUID
- invalid format -> `BAD_REQUEST`

Behavior:
- import row is created with `dpgf_imports.project_id = projectId`
- RLS decides final authorization for linked project

### 3) Hook contract
File: `src/hooks/useImportFlow.ts`

New signature:
```ts
useImportFlow(options?: { projectId?: string | null })
```

Behavior:
- worker JSON import includes `projectId`
- server fallback multipart includes `projectId`

### 4) Manual relink server action
File: `src/app/dashboard/_actions/imports.ts`

Action:
```ts
linkImportToProject(input: { importId: string; projectId?: string | null })
```

Behavior:
- validates UUIDs
- checks auth + current tenant membership
- validates target project access (owner/admin in tenant) when `projectId` is set
- updates `dpgf_imports.project_id`
- revalidates:
  - `/dashboard/imports`
  - `/dashboard/affaires/[projectId]` (when non-null)

### 5) Hub backend fetchers (UX2-006)
File: `src/lib/affaires/server.ts`

Delivered functions:
- `fetchAffaireHubSummary(projectId)`
- `fetchAffaireHubTimeline(projectId, page?)`
- `fetchAffaireHubDpgfSource(projectId)`
- `fetchAffaireHubPageData(projectId, page?)` (`Promise.all`)

#### `fetchAffaireHubSummary(projectId)` output
```ts
{
  project: {
    id: string;
    name: string;
    reference: string | null;
    clientName: string | null;
  };
  currentVersion: {
    id: string;
    projectId: string;
    versionNumber: number;
    status: "draft" | "sent" | "accepted" | "archived";
    totalHtCents: number;
    marginMultiplier: number;
    marginPercent: number; // (marginMultiplier - 1) * 100
    updatedAt: string;
  } | null;
  acceptedVersion: {
    id: string;
    projectId: string;
    versionNumber: number;
    status: "draft" | "sent" | "accepted" | "archived";
    totalHtCents: number;
    marginMultiplier: number;
    marginPercent: number;
    updatedAt: string;
  } | null;
  versionsCount: number;
  lineCount: number; // line items on current version
}
```

#### `fetchAffaireHubTimeline(projectId, page?)` output
Wrapper around existing `listEstimateProjectVersions`.
Returns:
```ts
{
  items: Array<{
    id: string;
    project_id: string;
    version_number: number;
    status: "draft" | "sent" | "accepted" | "archived";
    title: string | null;
    updated_at: string;
    created_at: string;
    total_ttc_cents: number;
    total_ht_cents: number;
    parent_version_id: string | null;
    variant_label: string | null;
    author_name: string | null;
  }>;
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
    has_prev: boolean;
    has_next: boolean;
  };
}
```

#### `fetchAffaireHubDpgfSource(projectId)` output
```ts
{
  importId: string;
  filename: string;
  sourceFormat: string;
  importStatus: string;
  mappingStatus: string | null;
  importedAt: string;
  mappingUpdatedAt: string | null;
  parseMode: string;
  rowCount: number;
} | null
```

Rules:
- returns `null` when no linked DPGF import exists for project
- mapping fields are based on latest `dpgf_mappings` row for latest linked import

#### `fetchAffaireHubPageData(projectId, page?)` output
```ts
{
  summary: Awaited<ReturnType<typeof fetchAffaireHubSummary>>;
  timeline: Awaited<ReturnType<typeof fetchAffaireHubTimeline>>;
  dpgfSource: Awaited<ReturnType<typeof fetchAffaireHubDpgfSource>>;
}
```

## Strict UI mapping for UX Frontend team

### Section A: Resume financier
Map:
- project title: `summary.project.name`
- project meta: `summary.project.reference`, `summary.project.clientName`
- HT version courante: `summary.currentVersion?.totalHtCents`
- HT derniere acceptee: `summary.acceptedVersion?.totalHtCents`
- marge appliquee (%): `summary.currentVersion?.marginPercent`
- nombre de lignes: `summary.lineCount`

### Section B: Versions timeline
Map:
- timeline source: `timeline.items`
- badges:
  - `courante`: item `id === summary.currentVersion?.id`
  - `derniere acceptee`: item `id === summary.acceptedVersion?.id`
- comparer visible if `summary.versionsCount > 1`

### Section C: Source DPGF
Map:
- nom fichier: `dpgfSource?.filename`
- statut import: `dpgfSource?.importStatus`
- statut mapping: `dpgfSource?.mappingStatus`
- date import: `dpgfSource?.importedAt`

### Section D: Actions rapides
Map/actions:
- Editer version courante -> `/dashboard/estimates/${summary.currentVersion.id}/edit`
- Exporter -> existing export flow on current version id
- Nouvelle version -> duplicate standard endpoint
- Dupliquer -> variant endpoint
- Comparer -> `/dashboard/estimates/${summary.currentVersion.id}/diff` (if `versionsCount > 1`)

## Required UX states

1. Affaire inexistante / non autorisee:
- call `notFound()`

2. Affaire sans versions:
- `summary.currentVersion === null`
- show contextual empty state + CTA "Creer une premiere version"

3. Affaire sans DPGF lie:
- `dpgfSource === null`
- explicit message + CTA vers imports

4. Erreurs partielles timeline/DPGF:
- recommended: load sections independently so one failure does not break page
- keep financial summary visible when possible

## Next.js constraints for implementation (UX team)
- Dynamic route params in Next 16:
  - `params: Promise<{ projectId: string }>`
  - `const { projectId } = await params`
- Provide:
  - `src/app/dashboard/affaires/[projectId]/page.tsx`
  - `src/app/dashboard/affaires/[projectId]/loading.tsx`
  - `src/app/dashboard/affaires/[projectId]/error.tsx`
  - `src/app/dashboard/affaires/[projectId]/not-found.tsx`
  - `src/components/affaires/AffaireHub.tsx`
- Use `Suspense` boundaries for slow sections (timeline, dpgf source)
- If `usePathname()` is used in dynamic route clients, wrap under `Suspense`

## Responsive requirements (UX team)
- Mobile:
  - stacked sections
  - visible top back button
- Desktop:
  - 2-column layout
  - timeline and actions visible without horizontal scroll

## Shared acceptance scenarios
- `/dashboard/affaires` -> `/dashboard/affaires/[projectId]` -> back
- invalid/inaccessible project id -> `not-found`
- project with `versionsCount > 1` -> compare action visible
- project with linked DPGF import -> source block fully populated

# UX2-005 FS-A -> UX Frontend Handoff (Backend Contract)

## Scope
FS-A delivered backend-only foundation for `/dashboard/affaires`:
- SQL migration with indexes + RPC
- Server data module for list/counters/page wrapper
- Query normalization contract

No UI route/component is implemented in this batch.

## Server APIs to consume

### `fetchAffaireList(query)`
From: `src/lib/affaires/server.ts`

Input shape:
- `q?: string`
- `status?: ("draft" | "sent" | "accepted" | "archived")[]`
- `size?: 20 | 50 | 100`
- `cursor?: string` (base64url encoded JSON)
- `sort?: "updatedAt"` (other values normalized to `updatedAt`)

Output shape:
- `items: AffaireListItem[]`
- `pageSize: 20 | 50 | 100`
- `nextCursor: string | null`
- `hasNextPage: boolean`

`AffaireListItem`:
- `projectId`
- `projectName`
- `projectReference`
- `projectClient`
- `versionCount`
- `currentVersionId`
- `currentVersionNumber`
- `currentStatus`
- `currentTotalHtCents`
- `currentUpdatedAt`
- `acceptedVersionId`
- `acceptedVersionNumber`

### `fetchAffaireCounters(query)`
From: `src/lib/affaires/server.ts`

Input subset:
- `q?`
- `status?`

Output shape:
- `totalCount`
- `filteredCount`
- `statusCounts: { draft, sent, accepted, archived }`

Notes:
- `totalCount` = all affaires visibles (non archivées) dans le scope utilisateur.
- `filteredCount` = après `q` + `status`.
- `statusCounts` = buckets par statut courant après filtre `q` seulement.

### `fetchAffairePageData(query)`
Wrapper `Promise.all`:
- `list` + `counters`

Use this in `app/dashboard/affaires/page.tsx` server component.

## Cursor contract

Cursor payload (before base64url):
```json
{ "updatedAt": "2026-03-04T10:00:00+00:00", "projectId": "uuid" }
```

Ordering is fixed to keyset:
- `ORDER BY current_updated_at DESC, project_id DESC`
- next-page predicate:
`(current_updated_at, project_id) < (cursor.updatedAt, cursor.projectId)`

## UX implementation expectations

1. Implement route: `src/app/dashboard/affaires/page.tsx` (Server Component).
2. Implement route boundaries: `loading.tsx` + `error.tsx` in same segment.
3. Build two render modes:
- `AffairesCardList` (simplified)
- `AffairesDenseTable` (expert; load via `next/dynamic`)
4. Bind search to `q` (debounce in UI only).
5. Bind status multi-filter to `status=draft,accepted` URL format.
6. Bind page-size to `size` (persist in localStorage key `affaires-page-size`).
7. Use `nextCursor` for forward pagination (no OFFSET page number navigation).
8. Expose only active backend sort `Date MAJ`; keep `Nom`/`Montant` disabled/coming-soon.
9. CTA `Nouvelle affaire` points temporarily to `/dashboard/estimates/new`.
10. Row/card click targets `/dashboard/affaires/[projectId]` (hub UX2-006).

## Deferred items (explicit)
- Redirect `/dashboard/estimates -> /dashboard/affaires` is NOT enabled in this backend batch.
- UI mode switch (`simplified` / `expert`) wiring depends on UX2-001.

## UX Integration Plan (execution-ready)

### 1) Route wiring
1. Create `src/app/dashboard/affaires/page.tsx` as an async Server Component.
2. Read `searchParams` and convert to normalized query with `parseAffaireListQuery(...)` from `src/lib/affaires/schemas.ts`.
3. Call `fetchAffairePageData(normalizedQuery)` from `src/lib/affaires/server.ts`.
4. Pass DTOs to presentational UI components only:
   - `AffairesCardList` (simplified)
   - `AffairesDenseTable` (expert via `next/dynamic`)

### 2) URL contract (must stay stable)
1. `q=<text>`
2. `status=draft,accepted` (comma-separated list)
3. `size=20|50|100`
4. `cursor=<opaque-base64url>`
5. `sort=updatedAt` (default; keep other sort choices disabled visually)

### 3) Required UI states
1. Loading: `src/app/dashboard/affaires/loading.tsx`
2. Error: `src/app/dashboard/affaires/error.tsx`
3. Empty (no data): CTA “Nouvelle affaire” to `/dashboard/estimates/new`
4. Empty (filtered): message “Aucun résultat pour ces filtres”
5. List with next page available (`hasNextPage=true`)
6. List end (`hasNextPage=false`)

### 4) Data-to-UI mapping (strict)
1. Primary label: `projectName`
2. Secondary labels: `projectClient`, `projectReference`
3. Meta: `versionCount`
4. Current status badge: `currentVersionNumber + currentStatus`
5. Accepted badge (conditional): `acceptedVersionNumber` when not null
6. Amount: `currentTotalHtCents` (formatted currency in UI)
7. Last update: `currentUpdatedAt` (localized display in UI)

### 5) Interaction behavior
1. Search updates `q` only (debounce client-side).
2. Status filter updates `status`.
3. Page size updates `size` and persists localStorage key `affaires-page-size`.
4. Next page uses only `nextCursor` from backend response.
5. Row/card click goes to `/dashboard/affaires/[projectId]`.

### 6) Shared E2E acceptance (FS-A + UX)
1. Open `/dashboard/affaires` with seeded data.
2. Apply `q` filter and verify `filteredCount` update.
3. Apply multi-status filter and verify list + status chips consistency.
4. Move to next cursor page and back (if UX implements a “reset filters” path).
5. Click one affaire -> `/dashboard/affaires/[projectId]` -> return list.

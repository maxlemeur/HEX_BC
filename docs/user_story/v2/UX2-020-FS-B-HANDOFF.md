# UX2-020 FS-B -> UX Frontend Handoff (Backend Contract)

## Scope FS-B
FS-B delivered backend-only foundation for `/dashboard/analytics`:
- SQL migration with analytics RPCs + indexes.
- Server analytics module (`fetchChiffreurAnalytics`) with role/scope validation.
- Typed DB function signatures and Vitest backend coverage.
- Benchmark script for `EXPLAIN ANALYZE`.

FS-B does **not** implement analytics UI/components in this batch.

---

## Delivered backend surfaces

### 1) DB migration
File: `supabase/migrations/20260306_ux2_020_analytics.sql`

Includes:
- Indexes:
  - `estimate_projects_tenant_user_created_at_idx (tenant_id, user_id, created_at desc)`
  - `estimate_projects_tenant_created_at_idx (tenant_id, created_at desc)`
  - `estimate_versions_tenant_status_project_updated_idx (tenant_id, status, project_id, updated_at desc)`
    with partial predicate `status in ('sent','accepted')`

- RPC `get_chiffreur_analytics_kpis(p_tenant_id uuid, p_owner_user_id uuid default null)`
- RPC `list_chiffreur_analytics_trend(p_tenant_id uuid, p_owner_user_id uuid default null, p_months integer default 6)`
- RPC `list_chiffreur_analytics_owners(p_tenant_id uuid)`

Security model (aligned UX2-005):
- `p_tenant_id` required and must match `current_tenant_id()`.
- Owner scoping:
  - non-admin: `p_owner_user_id` must be `auth.uid()` (or null -> coerced to self).
  - admin: may pass `null` (all) or a specific owner UUID.
- Functions are `security invoker`, `stable`, granted to `authenticated`.

### 2) Server fetcher module
File: `src/lib/analytics/server.ts`

Main export:
```ts
fetchChiffreurAnalytics(input?: { ownerUserId?: string | null }): Promise<AnalyticsPayload>
```

Behavior:
- Reads auth/profile/tenant from `getUserContext()`.
- Uses `getSupabase()` and shared cached server fetchers (`cache(...)`).
- Runs all backend reads in parallel (`Promise.all`):
  - KPI RPC,
  - trend RPC,
  - top 10 affaires via existing `list_affaires_page`,
  - owners list (admin only).

Role rules:
- non-admin:
  - always scoped to self,
  - owner override forbidden (403).
- admin:
  - `ownerUserId = null` -> all users aggregate,
  - `ownerUserId = <uuid>` -> single owner view.

### 3) Payload contract
`AnalyticsPayload` returned by `fetchChiffreurAnalytics`:

```ts
{
  generatedAt: string;
  scope: {
    mode: "all" | "owner";
    ownerUserId: string | null;
    isAdmin: boolean;
    viewerRole: "admin" | "engineer" | "viewer";
  };
  kpis: {
    activeAffaires: number;
    acceptedRevenueCents: number;
    acceptedVersions: number;
    sentVersions: number;
    acceptanceRate: number; // rounded to 1 decimal
    avgDaysToFirstAcceptance: number | null; // rounded to 1 decimal
  };
  trend: Array<{
    key: string; // YYYY-MM
    label: string; // localized fr-FR month label
    createdCount: number;
    acceptedCount: number;
  }>;
  topAffaires: Array<{
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
    currentUpdatedAt: string;
    acceptedVersionId: string | null;
    acceptedVersionNumber: number | null;
  }>;
  owners: Array<{
    ownerUserId: string;
    ownerName: string;
    ownerRole: "admin" | "engineer";
    activeAffairesCount: number;
  }>;
}
```

### 4) Hybrid KPI semantics (locked)
- `activeAffaires`: number of non-archived projects (`is_archived = false`).
- `acceptedRevenueCents`, `acceptanceRate`, `avgDaysToFirstAcceptance`, trend:
  historical metrics include archived projects.
- `acceptanceRate` = `accepted_versions / (accepted_versions + sent_versions)`.
- `avgDaysToFirstAcceptance`:
  average days between `estimate_projects.created_at` and first project acceptance.
  Acceptance timestamp uses `estimate_version_events(event_type='accepted')` when present,
  fallback to `estimate_versions.updated_at`.
- `trend`:
  6 continuous monthly buckets (`YYYY-MM`), counts are:
  - created affaires per month,
  - first accepted affaires per month.

### 5) Existing RPC reuse
`topAffaires` uses existing:
```sql
public.list_affaires_page(...)
```
Called with:
- `p_limit = 10`
- `p_search = null`
- `p_statuses = null`
- `p_cursor_* = null`
- `p_sort_dir = 'desc'`

---

## UX frontend implementation contract (to execute by UX team)

### A) Route files to create
- `src/app/dashboard/analytics/page.tsx`
- `src/app/dashboard/analytics/loading.tsx`
- `src/app/dashboard/analytics/error.tsx`
- `src/components/analytics/ChiffreurDashboard.tsx`

### B) Data fetch pattern
- Read data in server route via `fetchChiffreurAnalytics(...)`.
- No internal API route required.

### C) URL contract
- Owner filter querystring:
  - `?owner=all`
  - `?owner=<uuid>`
- Default:
  - admin: `owner=all`
  - non-admin: owner fixed to self (no filter control)

### D) Visibility rules
- `viewer`: route not exposed in UI navigation (optional hard guard at page level if requested).
- `engineer` expert: sees personal analytics only.
- `admin`: sees all + owner selector.

### E) UI mapping
- KPI cards (4):
  - `kpis.activeAffaires`
  - `kpis.acceptedRevenueCents` (format EUR)
  - `kpis.acceptanceRate`
  - `kpis.avgDaysToFirstAcceptance`
- Trend chart/table:
  - `trend[].label`, `createdCount`, `acceptedCount`
- Top affaires table:
  - `topAffaires` rows + status/montant/date

### F) UX behaviors
- Auto-refresh every 60s using `router.refresh()`.
- Admin owner selector options = `payload.owners`.
- `owner=all` maps to `ownerUserId = null` when calling fetcher.

### G) Navigation + legacy redirect (frontend scope)
- Add `Analytics` item in navigation group `Outils`.
- Sync command palette destinations with new route.
- Legacy redirect in `next.config.ts`:
  - `/dashboard/estimates/dashboard` -> `/dashboard/analytics`
  - temporary, non-permanent.
- Update existing `Dashboard` link in estimates list to `/dashboard/analytics`.

---

## Tests and validation status

### Delivered by FS-B
- `src/lib/analytics/server.test.ts`:
  - engineer self-scope,
  - non-admin override forbidden,
  - admin all/owner scopes,
  - acceptance rate rounding,
  - invalid owner UUID validation.

### To run by UX team after UI integration
- Route access by role/mode.
- Owner filter updates KPI/trend/top.
- 60s refresh behavior.
- Legacy redirect behavior.

### Perf benchmark script
File: `supabase/benchmarks/ux2_020_analytics_explain.sql`

Scenarios:
- admin all-scope,
- admin owner-scope,
- engineer self-scope.

Expected check:
- no unjustified `Seq Scan` on critical paths for production-sized tenants.

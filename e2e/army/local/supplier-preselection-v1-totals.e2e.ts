import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyItem } from "../critical/fixtures";
import { expectStoredTotalsMatchLines } from "../critical/version-totals-support";
import { ownedEstimateContext, querySql } from "./calculation-gate-support";

// Stored version totals after a supplier preselection on a legacy V1 draft, in a suite a CI
// workflow runs (docs/testing/version-totals-after-preselection.md, T2). OZ04 asserts the same
// path in the calc-v3 "offers" phase, which no workflow runs; the critical P1 journey is the V2
// guard. The public creation schema only makes V2 drafts, so the V1 draft is inserted in SQL by
// the native owner of the owned stack, as engine-v3-fail-closed does for v3. The preselection is
// in Expert mode only: the journey switches the shared account's profile and restores it, like
// bulk-edit-sync-sources. For that reason it belongs to the nightly full selection (one worker),
// not to the critical CI selection (two workers, files in parallel).
const options = { session: "army", tags: ["critical", "local", "version-totals"], timeout: 240_000 } as const;
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type UiMode = "simplified" | "expert";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
// Fixed margin x1, 20 % VAT, no discount, no rounding: 3 u at 10,00 € (seeded, consistent),
// then at the 12,34 € offer: 37,02 € HT, 7,40 € VAT (740,4 c rounded), 44,42 € TTC.
const SEEDED: [number, number, number] = [3000, 600, 3600];
const EXPECTED: [number, number, number] = [3702, 740, 4442];

function assertOwnedLocalBackend() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
    !process.env.E2E_ARMY_LOCAL_DB_URL) {
    throw new Error("The legacy V1 draft requires the owned local Supabase stack and its SQL route.");
  }
}

async function createdData<T>(response: { status: number; body: Envelope<T> }) {
  expect([200, 201]).toContain(response.status);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

async function setUiMode(userId: string, mode: UiMode): Promise<UiMode> {
  if (!UUID.test(userId)) throw new Error("Invalid profile identity.");
  const output = await querySql(`BEGIN;
SELECT ui_mode FROM public.profiles WHERE id = '${userId}' AND current_user = 'postgres' FOR UPDATE;
UPDATE public.profiles SET ui_mode = '${mode}' WHERE id = '${userId}';
COMMIT;
SELECT 'ARMY_UI_MODE_COMMITTED';
`);
  const [previous, marker] = output;
  if (output.length !== 2 || marker !== "ARMY_UI_MODE_COMMITTED" || (previous !== "simplified" && previous !== "expert")) {
    throw new Error("The UI mode change of the owned profile is ambiguous; no retry.");
  }
  return previous;
}

type V1Draft = { projectId: string; versionId: string; sectionId: string; lineId: string; title: string };

async function insertLegacyV1Draft(
  owner: { projectId: string; tenantId: string; userId: string },
  line: { title: string; productId: string },
): Promise<V1Draft> {
  const draft = { projectId: owner.projectId, versionId: randomUUID(), sectionId: randomUUID(), lineId: randomUUID(), title: `${line.title} V1` };
  const context = { ...owner, ...draft, lineTitle: line.title, productId: line.productId };
  if (![owner.projectId, owner.tenantId, owner.userId, line.productId].every((id) => UUID.test(id))) {
    throw new Error("Invalid legacy V1 draft identity.");
  }
  const delimiter = `$army_${randomUUID().replaceAll("-", "")}$`;
  if (JSON.stringify(context).includes(delimiter)) throw new Error("Legacy V1 draft SQL delimiter collision.");
  const output = await querySql(`BEGIN;
DO ${delimiter}
DECLARE ctx jsonb := ${literal(context)};
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.estimate_projects p
    JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active AND t.name ~ '^ARMY\\y'
    WHERE p.id = (ctx->>'projectId')::uuid AND p.tenant_id = (ctx->>'tenantId')::uuid AND p.user_id = (ctx->>'userId')::uuid)
  THEN RAISE EXCEPTION 'The owned ARMY project identity differs'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.products a WHERE a.id = (ctx->>'productId')::uuid AND a.tenant_id = (ctx->>'tenantId')::uuid)
  THEN RAISE EXCEPTION 'The owned ARMY article identity differs'; END IF;
  INSERT INTO public.estimate_versions (
    id, tenant_id, project_id, version_number, status, calc_engine_version, title, currency,
    margin_mode, margin_multiplier, margin_bp, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents,
    discount_bp, discount_mode, discount_steps, contractor_role, max_section_depth,
    total_ht_cents, total_tax_cents, total_ttc_cents
  )
  SELECT (ctx->>'versionId')::uuid, p.tenant_id, p.id,
    coalesce((SELECT max(v.version_number) FROM public.estimate_versions v WHERE v.project_id = p.id), 0) + 1,
    'draft', 1, ctx->>'title', 'EUR', 'fixed', 1, 0, 1, 2000, 'none', 1, 0, 'simple', '{}', 'principal', 1,
    ${SEEDED[0]}, ${SEEDED[1]}, ${SEEDED[2]}
  FROM public.estimate_projects p WHERE p.id = (ctx->>'projectId')::uuid;
  INSERT INTO public.estimate_items (id, tenant_id, version_id, item_type, position, title)
  SELECT (ctx->>'sectionId')::uuid, v.tenant_id, v.id, 'section', 0, 'Lot ' || (ctx->>'title')
  FROM public.estimate_versions v WHERE v.id = (ctx->>'versionId')::uuid;
  INSERT INTO public.estimate_items (
    id, tenant_id, version_id, parent_id, item_type, line_nature, position, title, description, product_id,
    quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
    pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
  )
  SELECT (ctx->>'lineId')::uuid, v.tenant_id, v.id, (ctx->>'sectionId')::uuid, 'line', 'supply_only', 1, ctx->>'lineTitle', 'u',
    (ctx->>'productId')::uuid, 3, 1000, 2000, 1, 0, 1, 1, 1000, ${SEEDED[0]}, ${SEEDED[1]}, ${SEEDED[2]}
  FROM public.estimate_versions v WHERE v.id = (ctx->>'versionId')::uuid;
END ${delimiter};
COMMIT;
SELECT 'ARMY_LEGACY_V1_DRAFT_COMMITTED';
`);
  if (!output.includes("ARMY_LEGACY_V1_DRAFT_COMMITTED")) throw new Error("Legacy V1 draft commit is ambiguous; no retry.");
  return draft;
}

armyTest("V1PT01 a supplier preselection on a legacy V1 draft stores the version totals with its lines", options,
  async ({ app, screen, browser, army }) => {
    assertOwnedLocalBackend();
    await app.open("/dashboard/affaires");
    // An owned project made by the ordinary creation path; its V2 draft stays version 1.
    const created = await createdData(await apiRequest<Envelope<{ project: { id: string }; version: { id: string } }>>(
      browser, "POST", "/api/estimates", {
        project: { name: army.projectName },
        version: {
          title: `${army.runPrefix} v2 anchor`, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000,
          rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR",
        },
      }));
    const projectId = created.project.id;
    ownEstimate(army, { projectId, versionId: created.version.id });
    const owner = await ownedEstimateContext(projectId);

    const designation = `${army.runPrefix} V1 article`;
    const product = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/products", {
      action: "create", item: { designation, reference: null, unit: "u", unit_price_cents: 1000 },
    }))).item;
    const supplier = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
      action: "create", item: { name: `${army.runPrefix} V1 fournisseur`, is_active: true },
    }))).item;
    const offer = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/prices", {
      action: "create", item: {
        supplier_id: supplier.id, product_id: product.id, supplier_sku: `${army.runPrefix}-V1`, unit: "u",
        min_quantity: 1, unit_price_cents: 1234, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10),
      },
    }))).item;
    const draft = await insertLegacyV1Draft({ projectId, tenantId: owner.tenantId, userId: owner.userId },
      { title: designation, productId: product.id });
    const estimate = { projectId, versionId: draft.versionId };
    ownEstimate(army, estimate);
    // Only the two read-only catalogue lookups of this owned project are allowed.
    army.ownedPriceLookupProjects = [projectId];

    const before = await readEstimate(browser, draft.versionId);
    const lineOf = (items: ArmyItem[]) => items.find((item) => item.id === draft.lineId);
    await recordEvidence(army, "v1-preselection-fixtures", {
      ...draft, anchorVersionId: created.version.id, productId: product.id, supplierId: supplier.id, offerId: offer.id,
      insertedBy: "postgres (owned native stack)", referenceCents: 1000, offerCents: 1234, quantity: 3, seeded: SEEDED,
      before: {
        engine: before.version.calc_engine_version ?? null, versionNumber: before.version.version_number ?? null,
        totals: [before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents],
        line: lineOf(before.items) ?? null,
      },
    });
    expect(before.version.calc_engine_version, "legacy V1 draft").toBe(1);
    expect([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]).toEqual(SEEDED);
    expect(lineOf(before.items)).toMatchObject({ product_id: product.id, unit_price_ht_cents: 1000, line_total_ht_cents: SEEDED[0] });

    const initialMode = await setUiMode(owner.userId, "expert");
    try {
      await app.open(`/dashboard/estimates/${draft.versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
      const price = screen.getByLabel(`Prix d’achat unitaire HT pour ${designation}`, { exact: true });
      await expect(price).toHaveValue("10.00");
      await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).click();
      await screen.getByTestId("estimate-editor-display-button", { visible: true }).click();
      const preselect = screen.getByTestId("estimate-editor-supplier-preselection-button");
      await expect(preselect).toBeEnabled({ timeout: 30_000 });
      await preselect.click();
      const dialog = screen.getByRole("dialog", /Présélection fournisseurs/);
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Sélectionner toutes les présélections fournisseurs", { exact: true }).check();
      await dialog.getByRole("button", "Appliquer la sélection", { exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      // The line and the version totals are written by one call: once the line is read back on
      // the offer, the totals are read once, without waiting for any later save.
      await expect.poll(async () => {
        const item = lineOf((await readEstimate(browser, draft.versionId)).items);
        return { price: item?.unit_price_ht_cents, selected: item?.selected_supplier_price_id ?? null };
      }, { timeout: 30_000, interval: 500 }).toEqual({ price: 1234, selected: offer.id });
      await expect(price).toHaveValue("12.34");
      await expectStoredTotalsMatchLines({ app, screen, browser }, army, {
        estimate, projectName: army.projectName, step: "v1-preselection", expected: EXPECTED,
      });
    } finally {
      const restoredFrom = await setUiMode(owner.userId, initialMode);
      await recordEvidence(army, "v1-preselection-restored", { initialMode, restoredFrom });
    }
  });

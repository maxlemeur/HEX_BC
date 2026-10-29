import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  createEstimate: vi.fn(),
  patchEstimateVersion: vi.fn(),
  createEstimateItem: vi.fn(),
  updateEstimateItem: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
  patchEstimateStatus: vi.fn(),
  duplicateEstimateVersion: vi.fn(),
  createEstimateVariant: vi.fn(),
  promoteEstimateVariant: vi.fn(),
  listEstimateVersionEvents: vi.fn(),
  verifyEstimateSeal: vi.fn(),
}));

import { POST as create } from "@/app/api/estimates/route";
import { PATCH as settings } from "@/app/api/estimates/[versionId]/route";
import { POST as createItem, PATCH as updateItem } from "@/app/api/estimates/[versionId]/items/route";
import { POST as bulk } from "@/app/api/estimates/[versionId]/items/bulk/route";
import { PATCH as status } from "@/app/api/estimates/[versionId]/status/route";
import { POST as duplicate } from "@/app/api/estimates/[versionId]/duplicate/route";
import { POST as variant, PATCH as promote } from "@/app/api/estimates/[versionId]/variants/route";
import { GET as events } from "@/app/api/estimates/[versionId]/events/route";
import { GET as verify } from "@/app/api/estimates/[versionId]/verify/route";
import { conflict } from "@/lib/estimates/errors";
import * as service from "@/lib/estimates/server";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = "2026-10-28T10:00:00.123456Z";

const operations = [
  { name: "create", method: "POST", handler: create, service: service.createEstimate,
    payload: { project: { name: "Affaire test" } } },
  { name: "settings", method: "PATCH", handler: settings, service: service.patchEstimateVersion,
    payload: { title: "Titre révisé", expected_content_revision: 4 } },
  { name: "item creation", method: "POST", handler: createItem, service: service.createEstimateItem,
    payload: { item_type: "line", title: "Tube cuivre" } },
  { name: "item update", method: "PATCH", handler: updateItem, service: service.updateEstimateItem,
    payload: { id: ITEM_ID, title: "Tube cuivre révisé" } },
  { name: "bulk", method: "POST", handler: bulk, service: service.bulkUpdateEstimateItems,
    payload: { updates: [{ id: ITEM_ID, title: "Tube cuivre révisé" }] } },
  { name: "status", method: "PATCH", handler: status, service: service.patchEstimateStatus,
    payload: { status: "sent" } },
  { name: "duplicate", method: "POST", handler: duplicate, service: service.duplicateEstimateVersion,
    payload: {} },
  { name: "variant", method: "POST", handler: variant, service: service.createEstimateVariant,
    payload: {} },
  { name: "promote", method: "PATCH", handler: promote, service: service.promoteEstimateVariant,
    payload: {} },
  { name: "events", method: "GET", handler: events, service: service.listEstimateVersionEvents },
  { name: "verify", method: "GET", handler: verify, service: service.verifyEstimateSeal },
];

function requestFor(operation: (typeof operations)[number]) {
  return new Request(`http://localhost/api/estimates/${VERSION_ID}`, {
    method: operation.method,
    headers: { "content-type": "application/json", "if-match": UPDATED_AT },
    ...(operation.method === "GET" ? {} : { body: JSON.stringify(operation.payload) }),
  });
}

function persistedFixture() {
  const { version: joinedVersion, items } = createEstimateEditorResponseFixture();
  const { estimate_projects: project, ...version } = joinedVersion;
  return { version, items, project: { ...project, tenant_id: version.tenant_id } };
}

function validResult(name: string) {
  const { version, items, project } = persistedFixture();
  switch (name) {
    case "create": return { project, version };
    case "settings": return { version, items };
    case "item creation":
    case "item update": return { item: items[0], version: { id: version.id, updated_at: version.updated_at, content_revision: version.content_revision } };
    case "bulk": return { updated_count: 3, version: { id: version.id, updated_at: version.updated_at } };
    case "status": return { version: { ...version, status: "sent" } };
    case "duplicate":
    case "variant": return { version_id: "55555555-5555-4555-8555-555555555555" };
    case "promote": return { version };
    case "events": return { events: [{
      id: ITEM_ID, estimate_version_id: VERSION_ID, event_type: "sent", metadata: {},
      created_by: null, actor_name: null, occurred_at: UPDATED_AT, created_at: UPDATED_AT,
    }] };
    case "verify": return { valid: false, computed_hash: "a".repeat(64), stored_hash: null, seal_payload_version: null,
      client_contract_version: null, calc_payload_version: null };
    default: throw new Error(`Unexpected operation ${name}`);
  }
}

describe("estimate route response boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(operations)("maps malformed $name results to 500 after the service completed", async (operation) => {
    vi.mocked(operation.service).mockResolvedValue({} as never);
    const response = await operation.handler(requestFor(operation), {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    expect(operation.service).toHaveBeenCalledOnce();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  });

  it.each(operations)("preserves deterministic refusals for $name", async (operation) => {
    vi.mocked(operation.service).mockRejectedValue(conflict("Version modifiée.", undefined, "VERSION_CONFLICT"));
    const response = await operation.handler(requestFor(operation), {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
  });

  it.each(operations)("accepts complete $name results and historical nullable seal evidence", async (operation) => {
    vi.mocked(operation.service).mockResolvedValue(validResult(operation.name) as never);
    const response = await operation.handler(requestFor(operation), {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    expect(response.status).toBe(["create", "item creation", "duplicate", "variant"].includes(operation.name) ? 201 : 200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    if (operation.name === "verify") expect(payload.data).toEqual(validResult("verify"));
    if (operation.name === "settings") expect(payload.data.version.updated_at).toBe(UPDATED_AT);
    if (operation.name === "bulk") expect(payload.data.updated_count).toBe(3);
  });

  it.each([
    ["settings", () => ({ ...validResult("settings"), version: { ...persistedFixture().version, content_revision: undefined } })],
    ["settings", () => ({ ...validResult("settings"), items: [{ ...persistedFixture().items[0], line_total_ttc_cents: 1 }] })],
    ["settings", () => ({ ...validResult("settings"), version: { ...persistedFixture().version, total_ttc_cents: 1 } })],
    ["item creation", () => ({ ...validResult("item creation"), item: { ...persistedFixture().items[0], version_id: ITEM_ID } })],
    ["item update", () => ({ ...validResult("item update"), item: { ...persistedFixture().items[0], id: VERSION_ID } })],
    ["bulk", () => ({ ...validResult("bulk"), version: { id: ITEM_ID, updated_at: UPDATED_AT } })],
    ["bulk", () => ({ ...validResult("bulk"), totals: { total_ht_cents: 1000, total_tax_cents: 200, total_ttc_cents: 1199 } })],
    ["status", () => ({ version: { ...persistedFixture().version, status: "draft" } })],
    ["status", () => ({ version: { ...persistedFixture().version, status: "unknown" } })],
    ["duplicate", () => ({ version_id: VERSION_ID })],
    ["variant", () => ({ version_id: VERSION_ID })],
    ["promote", () => ({ version: { ...persistedFixture().version, parent_version_id: ITEM_ID } })],
    ["promote", () => ({ version: { ...persistedFixture().version, variant_label: "Variante A" } })],
    ["promote", () => ({ version: { ...persistedFixture().version, id: ITEM_ID } })],
    ["verify", () => ({ ...validResult("verify"), valid: true })],
  ] as const)("rejects inconsistent %s receipts as server failures", async (name, result) => {
    const operation = operations.find((candidate) => candidate.name === name)!;
    vi.mocked(operation.service).mockResolvedValue(result() as never);
    const response = await operation.handler(requestFor(operation), { params: Promise.resolve({ versionId: VERSION_ID }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  });
});

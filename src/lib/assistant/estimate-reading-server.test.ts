import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/estimates/read-all-items-server", () => ({ readAllEstimateItems: vi.fn(), assertEstimateVersionUnchanged: vi.fn() }));
vi.mock("@/lib/estimates/version-totals", () => ({ calculateEstimateBreakdownForItems: vi.fn(), calculateEstimateV3SnapshotForItems: vi.fn() }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { estimateLineDetail, estimateOutline } from "@/lib/assistant/estimate-reading";
import { loadEstimateReading } from "@/lib/assistant/estimate-reading-server";
import { AssistantToolError } from "@/lib/assistant/loop";
import type { TenantRole } from "@/lib/auth/tenant-context";
import { conflict, forbidden } from "@/lib/http/api-response";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { calculateEstimateV3SnapshotForItems } from "@/lib/estimates/version-totals";
import { createInMemoryRestApi } from "@/test/in-memory-rest-api";

const TENANT = "tenant-1";
const OWNER = "owner-1";
const AFFAIRE = "conversation-affaire";

/** An issued engine 3 version, read on its frozen amounts. */
const issued = {
  id: "v-1", tenant_id: TENANT, project_id: AFFAIRE, status: "sent", calc_engine_version: 3,
  version_number: 1, variant_label: null, title: "Chaufferie", content_revision: 7, updated_at: "2026-11-12T10:00:00Z",
  total_ht_cents: 95_000, total_tax_cents: 19_000, total_ttc_cents: 114_000, gross_ht_cents: 100_000,
  discount_applied_cents: 5_000, commercial_rounding_cents: 0, sale_coefficient_fo: 1.25, sale_coefficient_mo: 1.4,
  currency: "EUR",
};
const line = {
  id: "l-1", item_type: "line", parent_id: null, title: "Radiateur fictif", description: "Acier, 600 × 800",
  position: 1, quantity: 10, unit_code: "u", pricing_status: "priced", unit_price_ht_cents: 8_000, k_fo: 1,
  fo_provision: null, h_mo_per_unit: 0.5, h_mo: 5, k_mo: 1, tax_rate_bp: 2000, pu_ht_cents: 10_000,
  snapshot_pu_ht_cents: 10_000, line_total_ht_cents: 95_000, snapshot_gross_ht_cents: 100_000,
  snapshot_gross_fo_ht_cents: 60_000, snapshot_fo_ht_cents: null, snapshot_mo_ht_cents: null,
  source_provider: "takeoff", source_file_name: "plan-fictif.pdf", source_page: 3, fo_price_origin: null, product_id: null,
};

function member(role: TenantRole, userId = "member-1", versions: Record<string, unknown>[] = [issued]) {
  const { client, requests } = createInMemoryRestApi({ estimate_versions: versions });
  vi.mocked(requireAffaireAccess).mockResolvedValue({
    context: { supabase: client, userId, tenantId: TENANT, tenantRole: role },
    project: { id: AFFAIRE, tenant_id: TENANT, user_id: OWNER, name: "Affaire", reference: null, client_name: null, is_archived: false },
  } as never);
  return requests;
}

describe("estimate read by the assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAllEstimateItems).mockResolvedValue([line] as never);
    vi.mocked(assertEstimateVersionUnchanged).mockResolvedValue(undefined);
  });

  it("checks that the member may still read the affaire, and reads nothing when they may not", async () => {
    const requests = member("engineer");
    vi.mocked(requireAffaireAccess).mockRejectedValue(forbidden("Accès refusé à cette affaire."));
    const read = loadEstimateReading({ versionId: "v-1", projectId: AFFAIRE });
    await expect(read).rejects.toBeInstanceOf(AssistantToolError);
    await expect(read).rejects.toThrow("introuvable ou vous n’y avez pas accès");
    expect(requireAffaireAccess).toHaveBeenCalledWith(AFFAIRE, "read");
    expect(requests).toEqual([]);
  });

  it("refuses an estimate of another affaire before reading any of its lines", async () => {
    member("admin", "admin-1", [{ ...issued, project_id: "another-affaire" }]);
    const read = loadEstimateReading({ versionId: "v-1", projectId: AFFAIRE });
    await expect(read).rejects.toThrow("n’appartient pas à l’affaire de cette conversation");
    expect(readAllEstimateItems).not.toHaveBeenCalled();
  });

  it("answers an estimate the member cannot see like a missing one, without saying which", async () => {
    member("engineer", OWNER, []);
    const read = loadEstimateReading({ versionId: "v-2", projectId: AFFAIRE });
    await expect(read).rejects.toBeInstanceOf(AssistantToolError);
    await expect(read).rejects.toThrow("introuvable ou vous n’y avez pas accès");
  });

  it("gives the owner and an admin the estimate as the editor shows it: entries, cost shares and settings", async () => {
    for (const [role, userId] of [["engineer", OWNER], ["admin", "admin-1"]] as const) {
      member(role, userId);
      const reading = await loadEstimateReading({ versionId: "v-1", projectId: AFFAIRE });
      expect(estimateOutline(reading)).toHaveProperty("parametres", { coefficient_vente_fo: 1.25, coefficient_vente_mo: 1.4 });
      expect(estimateLineDetail(reading, "l-1")).toMatchObject({
        description: "Acier, 600 × 800", source: "takeoff, plan-fictif.pdf, page 3",
        saisie: { prix_base_fo_ht: "80,00 €", heures_mo_par_unite: 0.5, k_mo: 1, taux_tva: "20 %" },
        calcul: { part_fo_ht: "600,00 €", part_mo_ht: "400,00 €", heures_mo: "5" },
      });
    }
  });

  it("gives a director, who reads the affaire without opening its estimates in the editor, what the estimate page shows", async () => {
    member("director", "director-1");
    const reading = await loadEstimateReading({ versionId: "v-1", projectId: AFFAIRE });
    const outline = estimateOutline(reading);
    expect(outline).not.toHaveProperty("parametres");
    expect(outline.totaux).toEqual({
      total_brut_ht: "1 000,00 €", remise: "50,00 €", arrondi_commercial: "0,00 €", total_ht: "950,00 €",
      tva: "190,00 €", total_ttc: "1 140,00 €",
    });
    expect(outline).toHaveProperty("restriction");
    expect(estimateLineDetail(reading, "l-1")).toEqual({
      devis: expect.objectContaining({ id: "v-1", version: "V1" }),
      restriction: expect.stringContaining("que pour le propriétaire de l’affaire et les administrateurs"),
      id: "l-1", section: "", designation: "Radiateur fictif", quantite: 10, unite: "u", statut: "Chiffrée",
      taux_tva: "20 %", calcul: { pu_ht: "100,00 €", total_ht: "1 000,00 €", total_net_ht_apres_remise: "950,00 €" },
    });
  });

  it("reads a director's engine 3 draft on the amounts its page shows, stored by its last save, without computing it", async () => {
    member("director", "director-1", [{ ...issued, status: "draft" }]);
    const reading = await loadEstimateReading({ versionId: "v-1", projectId: AFFAIRE });
    expect(calculateEstimateV3SnapshotForItems).not.toHaveBeenCalled();
    expect(estimateOutline(reading)).toMatchObject({
      devis: { statut: "draft", montants: "montants enregistrés du brouillon" },
      totaux: { total_brut_ht: "1 000,00 €", remise: "50,00 €", total_ht: "950,00 €", total_ttc: "1 140,00 €" },
    });
  });

  describe("an estimate edited while it is read", () => {
    it("gives the reading once the version is checked to be the one that was read", async () => {
      member("engineer", OWNER);
      const reading = await loadEstimateReading({ versionId: "v-1", projectId: AFFAIRE });
      expect(reading.totals.totalHtCents).toBe(95_000);
      expect(assertEstimateVersionUnchanged).toHaveBeenCalledWith(expect.objectContaining({ version: issued }));
    });

    it("gives no amount when lines were read across two revisions, and asks to read again", async () => {
      member("engineer", OWNER);
      vi.mocked(assertEstimateVersionUnchanged).mockRejectedValue(conflict("Version modifiée ailleurs", undefined, "VERSION_CONFLICT"));
      const read = loadEstimateReading({ versionId: "v-1", projectId: AFFAIRE });
      await expect(read).rejects.toBeInstanceOf(AssistantToolError);
      await expect(read).rejects.toThrow("modifié pendant la lecture");
    });
  });
});

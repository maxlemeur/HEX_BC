import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { ToastProvider } from "@/components/ui-legacy/Toast";
import { EstimateApiError } from "@/lib/estimates/client";
import { AffaireOrderDraftsPanel } from "./AffaireOrderDraftsPanel";

const {
  fetchPreparationMock,
  fetchReceiptMock,
  createDraftsMock,
  createSupabaseBrowserClientMock,
  routerRefreshMock,
  onPreparationReadinessMock,
} = vi.hoisted(() => ({
  fetchPreparationMock: vi.fn(),
  fetchReceiptMock: vi.fn(),
  createDraftsMock: vi.fn(),
  createSupabaseBrowserClientMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  onPreparationReadinessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}));

vi.mock("@/lib/estimates/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/estimates/client")>(
    "@/lib/estimates/client"
  );

  return {
    ...actual,
    fetchEstimatePurchaseOrderDraftPreparation: fetchPreparationMock,
    fetchEstimatePurchaseOrderDraftReceipt: fetchReceiptMock,
    createEstimatePurchaseOrderDrafts: createDraftsMock,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

function makePreparation() {
  return {
    versionId: "version-1",
    stalePriceDays: 90,
    summary: {
      totalSupplierLines: 3,
      draftableLines: 2,
      blockedLines: 1,
      supplierGroups: 1,
      selectionMissingLines: 1,
      staleLines: 0,
      ambiguousLines: 0,
      noPriceLines: 0,
      missingQuantityLines: 0,
      nonIntegerQuantityLines: 0,
      missingUnitPriceLines: 0,
      transferredLines: 0,
    },
    transferredLines: [],
    groups: [
      {
        groupKey: "supplier:supplier-1",
        supplierId: "supplier-1",
        supplierName: "Best Supplier",
        lineCount: 2,
        totalHtCents: 25200,
        totalTaxCents: 5040,
        totalTtcCents: 30240,
        lines: [
          {
            itemId: "item-1",
            itemTitle: "Tube cuivre 18",
            quantity: 12,
            unit: "m",
            reviewFingerprint: "a".repeat(64),
            unitPriceHtCents: 2100,
            taxRateBp: 2000,
            lineTotalHtCents: 25200,
            lineTaxCents: 5040,
            lineTotalTtcCents: 30240,
            selectedSupplierPriceId: "price-1",
            supplierReference: "TC18-LIVE",
            productDesignation: "Tube cuivre 18",
          },
          {
            itemId: "item-2",
            itemTitle: "Collier de fixation",
            quantity: 4,
            unit: "u",
            reviewFingerprint: "b".repeat(64),
            unitPriceHtCents: 180,
            taxRateBp: 2000,
            lineTotalHtCents: 720,
            lineTaxCents: 144,
            lineTotalTtcCents: 864,
            selectedSupplierPriceId: "price-2",
            supplierReference: null,
            productDesignation: "Collier de fixation",
          },
        ],
      },
    ],
    blockedLines: [
      {
        itemId: "item-3",
        itemTitle: "Ligne a arbitrer",
        quantity: 4,
        unitPriceHtCents: 1000,
        taxRateBp: 2000,
        selectedSupplierPriceId: null,
        reason: "selection_missing" as const,
        coverageStatus: "covered",
        riskFlags: ["selection_missing"],
        selectedAlternative: null,
        alternatives: [],
      },
    ],
  };
}

function makeSites() {
  return [
    {
      id: "site-1",
      updated_at: "2026-10-11T09:00:00.000Z",
      name: "Chantier Lyon",
      project_code: "LY-42",
      address: "1 rue du chantier",
      postal_code: "69000",
      city: "Lyon",
      contact_name: "Chef Chantier",
      contact_phone: "0102030405",
    },
  ];
}

function installSiteClient() {
  const orderMock = vi.fn().mockResolvedValue({
    data: makeSites(),
    error: null,
  });
  const eqMock = vi.fn().mockReturnValue({
    order: orderMock,
  });
  const selectMock = vi.fn().mockReturnValue({
    eq: eqMock,
  });
  const fromMock = vi.fn().mockReturnValue({
    select: selectMock,
  });

  createSupabaseBrowserClientMock.mockReturnValue({
    from: fromMock,
  });

  return {
    orderMock,
  };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <AffaireOrderDraftsPanel
        projectId="project-1"
        currentVersion={{
          id: "version-1",
          status: "draft",
          versionNumber: 1,
        }}
        onPreparationReadiness={onPreparationReadinessMock}
        refreshSignal={{
          status: "ready",
          counts: { totalSupplierLines: 4, draftableLines: 4, transferredLines: 0, blockedLines: 0 },
          errorMessage: null,
        }}
      />
    </ToastProvider>
  );
}

describe("AffaireOrderDraftsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    fetchReceiptMock.mockResolvedValue(null);
    installSiteClient();
    fetchPreparationMock.mockResolvedValue(makePreparation());
  });

  it("keeps created draft links visible when the follow-up refresh fails", async () => {
    const user = userEvent.setup();
    fetchPreparationMock
      .mockResolvedValueOnce(makePreparation())
      .mockRejectedValueOnce(new Error("Recharge preparation indisponible"));
    createDraftsMock.mockResolvedValueOnce({
      sourceVersionId: "version-1",
      idempotencyKey: "65797ffd-f3aa-4dc4-bbb3-6b9e3a24f4fe",
      replayed: false,
      summary: {
        draftOrdersCreated: 1,
        draftLinesCreated: 2,
      },
      orders: [
        {
          purchaseOrderId: "po-1",
          currentStatus: "draft",
          canOpen: true,
          reference: "C-2603-011",
          supplierId: "supplier-1",
          supplierName: "Best Supplier",
          deliverySiteId: "site-1",
          itemCount: 2,
          totalHtCents: 25200,
          totalTaxCents: 5040,
          totalTtcCents: 30240,
          orderedSourceItemIds: ["item-1", "item-2"],
        },
      ],
    });

    renderPanel();

    await screen.findAllByText("Best Supplier");
    expect(screen.getByText("2 lignes préparables · 0 ligne déjà transférée · 1 ligne à corriger.")).toBeInTheDocument();
    await user.selectOptions(
      screen.getAllByRole("combobox", { name: /Chantier de livraison/i })[0]!,
      "site-1"
    );
    await user.click(
      screen.getByRole("checkbox", { name: /J’ai vérifié les lignes/i })
    );
    await user.click(
      screen.getAllByRole("button", { name: /Créer le brouillon/i })[0]!
    );

    expect(
      await screen.findByRole("link", { name: /Ouvrir le brouillon/i })
    ).toHaveAttribute("href", "/dashboard/orders/po-1");
    expect(
      screen.getByText("Recharge preparation indisponible")
    ).toBeInTheDocument();
    expect(screen.getByText("Préparation indisponible. Rechargez pour vérifier les lignes.")).toBeInTheDocument();
    expect(screen.queryByText("Brouillons proposés")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Créer le brouillon/i })).not.toBeInTheDocument();
    expect(onPreparationReadinessMock).toHaveBeenLastCalledWith("version-1", {
      status: "unavailable",
      counts: null,
      errorMessage: "Préparation indisponible. Rechargez pour vérifier les lignes.",
    });
  });

  it("submits the explicit TBD delivery-date state", async () => {
    const user = userEvent.setup();
    createDraftsMock.mockResolvedValueOnce({
      sourceVersionId: "version-1",
      idempotencyKey: "65797ffd-f3aa-4dc4-bbb3-6b9e3a24f4fe",
      replayed: false,
      summary: {
        draftOrdersCreated: 1,
        draftLinesCreated: 2,
      },
      orders: [
        {
          purchaseOrderId: "po-1",
          currentStatus: "draft",
          canOpen: true,
          reference: "C-2603-011",
          supplierId: "supplier-1",
          supplierName: "Best Supplier",
          deliverySiteId: "site-1",
          itemCount: 2,
          totalHtCents: 25200,
          totalTaxCents: 5040,
          totalTtcCents: 30240,
          orderedSourceItemIds: ["item-1", "item-2"],
        },
      ],
    });

    renderPanel();

    await screen.findAllByText("Best Supplier");
    await user.selectOptions(
      screen.getAllByRole("combobox", { name: /Chantier de livraison/i })[0]!,
      "site-1"
    );
    await user.click(screen.getByRole("checkbox", { name: /À déterminer/i }));
    await user.click(screen.getByRole("checkbox", { name: /J’ai vérifié les lignes/i }));
    await user.click(
      screen.getAllByRole("button", { name: /Créer le brouillon/i })[0]!
    );

    await waitFor(() => {
      expect(createDraftsMock).toHaveBeenCalledWith("version-1", {
        idempotencyKey: expect.any(String),
        reviewedLines: [
          { itemId: "item-1", reviewFingerprint: "a".repeat(64) },
          { itemId: "item-2", reviewFingerprint: "b".repeat(64) },
        ],
        groups: [
          {
            supplierId: "supplier-1",
            deliverySiteId: "site-1",
            deliverySiteUpdatedAt: "2026-10-11T09:00:00.000Z",
            itemIds: ["item-1", "item-2"],
            expectedDeliveryDate: "TBD",
            notes: null,
          },
        ],
      });
    });
  });

  it("clears an unavailable delivery site after reloading supplier groups", async () => {
    const user = userEvent.setup();
    const { orderMock } = installSiteClient();
    orderMock
      .mockResolvedValueOnce({
        data: makeSites(),
        error: null,
      })
      .mockResolvedValueOnce({
        data: [],
        error: null,
      });

    renderPanel();

    const siteSelect = (await screen.findAllByRole("combobox", {
      name: /Chantier de livraison/i,
    }))[0]!;
    await user.selectOptions(siteSelect, "site-1");
    await user.click(screen.getByRole("checkbox", { name: /J’ai vérifié les lignes/i }));
    expect(siteSelect).toHaveValue("site-1");

    await user.click(
      screen.getAllByRole("button", { name: /Relire les regroupements/i })[0]!
    );

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /Chantier de livraison/i })).toHaveValue("");
    });
    expect(
      screen.getAllByRole("button", { name: /Créer le brouillon/i })[0]
    ).toBeDisabled();
  });

  it("surfaces stale preparation conflicts without hiding the finish line", async () => {
    const user = userEvent.setup();
    createDraftsMock.mockRejectedValueOnce(
      new EstimateApiError(
        "Preparation stale",
        409,
        null,
        "ORDER_DRAFT_PREPARATION_STALE"
      )
    );

    renderPanel();

    await screen.findAllByText("Best Supplier");
    await user.selectOptions(
      screen.getAllByRole("combobox", { name: /Chantier de livraison/i })[0]!,
      "site-1"
    );
    await user.click(screen.getByRole("checkbox", { name: /J’ai vérifié les lignes/i }));
    await user.click(
      screen.getAllByRole("button", { name: /Créer le brouillon/i })[0]!
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Les regroupements ont changé/i
      );
    });
    expect(screen.queryByText("Brouillons proposés")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Créer le brouillon/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recharger la préparation/i })).toBeInTheDocument();
  });
});

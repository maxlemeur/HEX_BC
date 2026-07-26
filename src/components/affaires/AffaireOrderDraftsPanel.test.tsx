import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";
import { EstimateApiError } from "@/lib/estimates/client";
import { AffaireOrderDraftsPanel } from "./AffaireOrderDraftsPanel";

const {
  fetchPreparationMock,
  createDraftsMock,
  createSupabaseBrowserClientMock,
  routerRefreshMock,
} = vi.hoisted(() => ({
  fetchPreparationMock: vi.fn(),
  createDraftsMock: vi.fn(),
  createSupabaseBrowserClientMock: vi.fn(),
  routerRefreshMock: vi.fn(),
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
    },
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
        readyToOrder={{
          status: "blocked",
          orderableLinesCount: 3,
          coveredLinesCount: 2,
          ambiguousLinesCount: 0,
          missingPriceLinesCount: 1,
          staleLinesCount: 0,
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
    vi.clearAllMocks();
    installSiteClient();
    fetchPreparationMock.mockResolvedValue(makePreparation());
  });

  it("prioritizes blocked lines before draftable supplier groups", async () => {
    renderPanel();

    expect(
      await screen.findByRole("heading", {
        name: /Brouillons par fournisseur, sans ressaisie/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText("A traiter avant la creation")).toBeInTheDocument();
    expect(screen.getByText("Ligne a arbitrer")).toBeInTheDocument();
    expect(screen.getByText("Choix fournisseur a confirmer")).toBeInTheDocument();
    expect(screen.getByText("Brouillons proposes")).toBeInTheDocument();
    expect(screen.getByText("Best Supplier")).toBeInTheDocument();
  });

  it("creates draft orders explicitly from the selected supplier groups", async () => {
    const user = userEvent.setup();
    createDraftsMock.mockResolvedValueOnce({
      sourceVersionId: "version-1",
      summary: {
        draftOrdersCreated: 1,
        draftLinesCreated: 2,
      },
      orders: [
        {
          purchaseOrderId: "po-1",
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
    await user.type(
      screen.getAllByRole("textbox", {
        name: /Note reprise sur chaque brouillon/i,
      })[0]!,
      "Livraison a confirmer"
    );
    await user.click(
      screen.getAllByRole("button", { name: /Créer le brouillon/i })[0]!
    );

    await waitFor(() => {
      expect(createDraftsMock).toHaveBeenCalledWith("version-1", {
        groups: [
          {
            supplierId: "supplier-1",
            deliverySiteId: "site-1",
            itemIds: ["item-1", "item-2"],
            expectedDeliveryDate: null,
            notes: "Livraison a confirmer",
          },
        ],
      });
    });

    expect(routerRefreshMock).toHaveBeenCalled();
    expect((await screen.findAllByText("Brouillons crees")).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", {
        name: /Ouvrir le brouillon/i,
      })
    ).toHaveAttribute("href", "/dashboard/orders/po-1");
  });

  it("keeps created draft links visible when the follow-up refresh fails", async () => {
    const user = userEvent.setup();
    fetchPreparationMock
      .mockResolvedValueOnce(makePreparation())
      .mockRejectedValueOnce(new Error("Recharge preparation indisponible"));
    createDraftsMock.mockResolvedValueOnce({
      sourceVersionId: "version-1",
      summary: {
        draftOrdersCreated: 1,
        draftLinesCreated: 2,
      },
      orders: [
        {
          purchaseOrderId: "po-1",
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
    await user.click(
      screen.getAllByRole("button", { name: /Créer le brouillon/i })[0]!
    );

    expect(
      await screen.findByRole("link", { name: /Ouvrir le brouillon/i })
    ).toHaveAttribute("href", "/dashboard/orders/po-1");
    expect(
      screen.getByText("Recharge preparation indisponible")
    ).toBeInTheDocument();
    expect(screen.getByText("Brouillons proposes")).toBeInTheDocument();
  });

  it("submits the explicit TBD delivery-date state", async () => {
    const user = userEvent.setup();
    createDraftsMock.mockResolvedValueOnce({
      sourceVersionId: "version-1",
      summary: {
        draftOrdersCreated: 1,
        draftLinesCreated: 2,
      },
      orders: [
        {
          purchaseOrderId: "po-1",
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
    await user.click(
      screen.getAllByRole("button", { name: /Créer le brouillon/i })[0]!
    );

    await waitFor(() => {
      expect(createDraftsMock).toHaveBeenCalledWith("version-1", {
        groups: [
          {
            supplierId: "supplier-1",
            deliverySiteId: "site-1",
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
    expect(siteSelect).toHaveValue("site-1");

    await user.click(
      screen.getAllByRole("button", { name: /Relire les regroupements/i })[0]!
    );

    await waitFor(() => {
      expect(siteSelect).toHaveValue("");
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
    await user.click(
      screen.getAllByRole("button", { name: /Créer le brouillon/i })[0]!
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Les regroupements ont changé/i
      );
    });
    expect(screen.getByText("Brouillons proposes")).toBeInTheDocument();
  });
});

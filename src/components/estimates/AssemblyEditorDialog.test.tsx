import {
cleanup,
render,
screen,
waitFor,
within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,describe,expect,it,vi } from "vitest";

import {
AssemblyEditorDialog,
type AssemblyEditorInput,
} from "@/components/estimates/AssemblyEditorDialog";
import type { EstimateAssemblyDetail } from "@/lib/estimates/client";

const LABOR_ROLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLY_TYPE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SUPPLY_TYPES = [
  {
    id: SUPPLY_TYPE_ID,
    tenant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    code: "TUBE",
    name: "Tube",
    default_fo_provision: 1.03,
    created_at: "2026-07-14T08:00:00.000Z",
    updated_at: "2026-07-14T08:00:00.000Z",
  },
];

const ASSEMBLY: EstimateAssemblyDetail = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Pose de cloison",
  description: "Ouvrage avec main-d’œuvre",
  referenceCode: "ASM-CLOISON",
  unit: "m²",
  pricingSource: "manual",
  directCostCents: 9000,
  targetPriceCents: 0,
  averageOutputRate: null,
  averageTimeHours: 2,
  sourceMetadata: {},
  createdBy: null,
  createdAt: "2026-07-14T08:00:00.000Z",
  updatedAt: "2026-07-14T08:00:00.000Z",
  itemCount: 1,
  items: [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      tenant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      assembly_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Compagnon plaquiste",
      unit: "h",
      k_fo: 0,
      k_mo: 1,
      labor_role_id: LABOR_ROLE_ID,
      supply_type_id: null,
      default_quantity: 1,
      h_mo: 2,
      position: 1,
      cost_type: "labor",
      unit_cost_ht_cents: 4500,
      loss_coeff_bp: 0,
      yield_value: null,
      yield_unit: null,
      source_metadata: {},
      created_at: "2026-07-14T08:00:00.000Z",
      updated_at: "2026-07-14T08:00:00.000Z",
    },
  ],
};

describe("AssemblyEditorDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("restores catalogue prices when an older replacement erased every stored cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          items: [
            {
              id: "catalogue-inox",
              reference: "DB_I4Lsoude__Tub.I4S.50",
              designation:
                "Tube DN50 60,3x2 — Tube Inox 304L roulé soudé - soudé",
              unit: "ml",
              unit_price_cents: 998,
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        initialValue={{
          ...ASSEMBLY,
          directCostCents: 0,
          items: [
            {
              ...ASSEMBLY.items[0],
              title: "Tube DN50 60,3x2 — Tube Inox 304L roulé soudé - soudé",
              unit: "ml",
              cost_type: "material",
              default_quantity: 1,
              h_mo: 0,
              k_fo: 0.5,
              labor_role_id: null,
              unit_cost_ht_cents: 0,
            },
          ],
        }}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[]}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Prix de revient FO (€)")).toHaveValue(9.98)
    );
    expect(screen.getAllByText(/4,99/)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("search=Tube+DN50+60"),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("separates quantity from labor time and uses coefficients instead of losses", async () => {
    const user = userEvent.setup();
    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        initialValue={{
          ...ASSEMBLY,
          items: [
            {
              ...ASSEMBLY.items[0],
              k_mo: 1.5,
              loss_coeff_bp: 5000,
            },
          ],
        }}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[]}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />
    );

    // The dialog places its initial focus asynchronously. Let it finish before
    // typing into another field so it cannot redirect the keystroke to the name.
    await waitFor(() => expect(screen.getByLabelText(/Nom de l'ouvrage/)).toHaveFocus());

    const header = screen.getByTestId("assembly-items-header");
    expect(header).toHaveTextContent("Qté");
    expect(header).toHaveTextContent("PR FO");
    expect(header).toHaveTextContent("Type FO");
    expect(header).toHaveTextContent("K FO");
    expect(header).toHaveTextContent("H MO");
    expect(header).toHaveTextContent("Rôle MO");
    expect(header).toHaveTextContent("K MO");
    expect(header).toHaveTextContent("Total");
    expect(header).not.toHaveTextContent("PU HT");
    expect(header).not.toHaveTextContent("Coût HT");
    expect(header).not.toHaveTextContent("Pertes");
    expect(within(header).getByText("PR FO")).toHaveClass("bg-info-light");
    expect(within(header).getByText("Type FO")).toHaveClass("bg-info-light");
    expect(within(header).getByText("K FO")).toHaveClass("bg-info-light");
    expect(within(header).getByText("H MO")).toHaveClass("bg-warning-light");
    expect(within(header).getByText("Rôle MO")).toHaveClass("bg-warning-light");
    expect(within(header).getByText("K MO")).toHaveClass("bg-warning-light");
    expect(screen.getByLabelText("Prix de revient FO (€)")).toHaveClass(
      "bg-info-subtle"
    );
    expect(screen.getByLabelText("Coefficient FO")).toHaveClass(
      "bg-info-subtle"
    );
    expect(screen.getByLabelText("Temps MO (h)")).toHaveClass(
      "bg-warning-subtle"
    );
    expect(screen.getByLabelText("Rôle de main-d’œuvre")).toHaveClass(
      "bg-warning-subtle"
    );
    expect(screen.getByLabelText("Coefficient MO")).toHaveClass(
      "bg-warning-subtle"
    );
    expect(screen.getByLabelText("Quantité par défaut")).toHaveValue(1);
    expect(screen.getByLabelText("Temps MO (h)")).toHaveValue(2);
    expect(screen.queryByLabelText("Pertes (%)")).not.toBeInTheDocument();
    expect(screen.getAllByText(/135,00/)).toHaveLength(2);

    await user.clear(screen.getByLabelText("Coefficient MO"));
    await user.type(screen.getByLabelText("Coefficient MO"), "2");
    expect(screen.getAllByText(/180,00/)).toHaveLength(2);
  });

  it("allows a supply line to select a labor role and enter labor time", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(input: AssemblyEditorInput) => Promise<void>>();
    onSubmit.mockResolvedValue(undefined);

    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        initialValue={null}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[
          {
            id: LABOR_ROLE_ID,
            tenant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            name: "Compagnon",
            hourly_rate_cents: 4500,
            is_active: true,
            position: 1,
            created_at: "2026-07-14T08:00:00.000Z",
            updated_at: "2026-07-14T08:00:00.000Z",
          },
        ]}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByLabelText("Nom de l'ouvrage *"), "Kit inox");
    await user.type(screen.getByLabelText("Désignation *"), "Tube inox");
    const laborRoleSelect = screen.getByLabelText("Rôle de main-d’œuvre");
    expect(laborRoleSelect).toBeEnabled();
    await user.selectOptions(laborRoleSelect, LABOR_ROLE_ID);
    await user.selectOptions(screen.getByLabelText("Type FO"), SUPPLY_TYPE_ID);
    await user.clear(screen.getByLabelText("Temps MO (h)"));
    await user.type(screen.getByLabelText("Temps MO (h)"), "1.5");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            costType: "material",
            laborRoleId: LABOR_ROLE_ID,
            supplyTypeId: SUPPLY_TYPE_ID,
            laborHours: 1.5,
          }),
        ],
      })
    );
  });
  it("composes an assembly from a reusable child and applies its quantity", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(input: AssemblyEditorInput) => Promise<void>>();
    onSubmit.mockResolvedValue(undefined);
    const childAssemblyId = "99999999-9999-4999-8999-999999999999";

    render(
      <AssemblyEditorDialog
        isSubmitting={false}
        supplyTypes={SUPPLY_TYPES}
        laborRoles={[]}
        availableAssemblies={[
          {
            id: childAssemblyId,
            name: "Pose de receveur",
            description: null,
            referenceCode: "ASM-RECEVEUR",
            unit: "u",
            directCostCents: 1250,
            averageTimeHours: 0.5,
            createdBy: null,
            createdAt: "2026-07-14T08:00:00.000Z",
            updatedAt: "2026-07-14T08:00:00.000Z",
            itemCount: 1,
            memberCount: 0,
          },
        ]}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByLabelText("Nom de l'ouvrage *"), "Salle de bains");
    await user.click(screen.getByRole("button", { name: "Retirer la ligne 1" }));
    await user.click(
      screen.getByRole("button", { name: /Ajouter un sous-ouvrage/ })
    );
    await user.selectOptions(
      screen.getByLabelText("Ouvrage réutilisable"),
      childAssemblyId
    );
    const quantity = screen.getByLabelText("Quantité");
    await user.clear(quantity);
    await user.type(quantity, "2");

    expect(screen.getAllByText(/25,00/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [],
        members: [
          {
            childAssemblyId,
            quantity: 2,
            position: 1,
          },
        ],
      })
    );
  });


});

import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateItemsForVersion: vi.fn(),
}));

vi.mock("@/lib/takeoff/client", () => ({
  previewTakeoffConversion: vi.fn(),
}));

import { TakeoffApplyWizard } from "@/components/takeoff/TakeoffApplyWizard";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/client";
import { previewTakeoffConversion } from "@/lib/takeoff/client";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";

const PREVIEW_RESPONSE = {
  job_id: JOB_ID,
  strategy: "append" as const,
  target_section_id: null,
  summary: {
    total_count: 1,
    included_count: 1,
    transformed_count: 1,
    overridden_count: 0,
    excluded_by_mapping_count: 0,
    assembly_insertions_count: 0,
  },
  items: [
    {
      item_id: ITEM_ID,
      source_order: 0,
      rule_id: "44444444-4444-4444-8444-444444444444",
      rule_name: "Rule set_price",
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 420,
      },
      applied_by: "rule" as const,
      original: {
        designation: "Tube PVC",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: null,
        assembly_id: null,
      },
      transformed: {
        designation: "Tube PVC",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: 420,
        assembly_id: null,
      },
    },
  ],
};

describe("TakeoffApplyWizard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([
      {
        id: SECTION_ID,
        parent_id: null,
        item_type: "section",
        position: 1,
        title: "Section A",
      },
    ] as never);
    vi.mocked(previewTakeoffConversion).mockResolvedValue(PREVIEW_RESPONSE);
  });

  it("requires a fresh preview after an override changes", async () => {
    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        includedCount={1}
        excludedCount={0}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID);
    });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();
    });

    fireEvent.change(screen.getByDisplayValue("Règle auto"), {
      target: { value: "set_price" },
    });

    expect(screen.getByText(/Les ajustements ont changé/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Recalculer la preview" }));

    await waitFor(() => {
      expect(screen.queryByText(/Les ajustements ont changé/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();
    });
  });
});

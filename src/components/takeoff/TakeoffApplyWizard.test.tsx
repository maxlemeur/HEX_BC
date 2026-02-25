import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        parent_id: null,
        item_type: "section",
        position: 1,
        title: "Section A",
      },
    ] as never);
    vi.mocked(previewTakeoffConversion).mockResolvedValue(PREVIEW_RESPONSE);
  });

  it("loads preview and submits overrides", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

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
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(fetchEstimateItemsForVersion).toHaveBeenCalledWith(VERSION_ID);
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(previewTakeoffConversion).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({
          strategy: "append",
          target_section_id: null,
        })
      );
    });

    const select = screen.getByDisplayValue("Regle auto") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "set_price" } });

    const priceInput = screen.getByDisplayValue("420") as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "990" } });

    fireEvent.click(screen.getByRole("button", { name: "Recalculer preview" }));

    await waitFor(() => {
      expect(previewTakeoffConversion).toHaveBeenLastCalledWith(
        JOB_ID,
        expect.objectContaining({
          overrides: [
            {
              item_id: ITEM_ID,
              action: "set_price",
              action_params: {
                unit_price_cents: 990,
              },
            },
          ],
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'application" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: "append",
          targetSectionId: null,
          overrides: [
            {
              item_id: ITEM_ID,
              action: "set_price",
              action_params: {
                unit_price_cents: 990,
              },
            },
          ],
        })
      );
    });
  });
});

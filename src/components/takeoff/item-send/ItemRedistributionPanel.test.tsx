import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ItemRedistributionPanel } from "@/components/takeoff/item-send/ItemRedistributionPanel";
import { requestItemRedistribution } from "@/lib/takeoff/client";

vi.mock("@/lib/takeoff/client", () => ({ requestItemRedistribution: vi.fn() }));

it("shows which destinations create a physical line and which keep theirs", async () => {
  vi.mocked(requestItemRedistribution).mockResolvedValueOnce({
    action: "list", options: [{ version_id: "version", version_number: 1, item_id: "item", title: "Lavabo" }],
  }).mockResolvedValueOnce({
    action: "preview", preview: {
      digest: "digest", currency: "EUR", sources: [], parts: [], blockers: [], remove_lines: [],
      destinations: [
        { key: "floor-1", label: "RDC", quantity: 3, raw: 3, line_id: "line" },
        { key: "floor-2", label: "Combles", quantity: 2, raw: 2, line_id: null },
      ],
    },
  });
  render(<ItemRedistributionPanel jobId="job" viewerKey="member" />);
  fireEvent.click(await screen.findByRole("button", { name: "Prévisualiser la redistribution" }));
  expect(await screen.findByText(/Combles · 2.*ligne à créer/)).toBeVisible();
  expect(screen.getByText(/RDC · 3.*ligne existante/)).toBeVisible();
});

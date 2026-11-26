import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import { TakeoffSourceBadge } from "@/components/takeoff/TakeoffSourceBadge";

afterEach(cleanup);

it("shows brief provenance on a materialized line generated without AI", async () => {
  const user = userEvent.setup();
  render(
    <TakeoffSourceBadge
      versionId="version-1"
      sourceProvider="version_zero_draft"
      sourceMetadata={{
        applications: [{
          draft_id: "draft-1",
          review_status: "accepted",
          generation_origin: "brief",
          effective: { title: "Pose de la menuiserie", quantity: 12, unit: "ml" },
        }],
      }}
    />
  );

  expect(screen.getByText("V0 · Brief")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Afficher la provenance de la V0" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("V0 issue du brief confirmé");
  expect(screen.getByRole("tooltip")).toHaveTextContent("Pose de la menuiserie");
});

it.each([["model", "IA V0"], [undefined, "V0"]] as const)(
  "labels the V0 estimate line when its recorded origin is %s",
  (origin, label) => {
    render(<TakeoffSourceBadge versionId="version-1" sourceProvider="version_zero_draft"
      sourceMetadata={{ applications: [{ draft_id: "draft-1", generation_origin: origin }] }} />);
    expect(screen.getByText(label)).toBeVisible();
  },
);

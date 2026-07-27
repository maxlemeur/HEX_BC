import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PortalHeader } from "@/components/portal/PortalHeader";

const BASE_PROPS = {
  projectName: "Chantier test",
  projectReference: "HEX-D-001",
  versionNumber: 1,
  totalHtCents: 10_000,
  totalTtcCents: 12_000,
  currency: "EUR" as const,
  expiresAt: "2099-12-31T00:00:00.000Z",
  status: "pending" as const,
};

afterEach(cleanup);

describe("PortalHeader", () => {
  it("shows the TTC amount under the normal VAT regime", () => {
    render(<PortalHeader {...BASE_PROPS} />);

    expect(screen.getByText("Montant TTC")).toBeInTheDocument();
    expect(screen.getByText(/120,00/)).toBeInTheDocument();
  });

  it("shows the HT amount under reverse charge", () => {
    render(<PortalHeader {...BASE_PROPS} vatReverseCharge />);

    expect(screen.getByText("Montant HT")).toBeInTheDocument();
    expect(screen.getByText(/100,00/)).toBeInTheDocument();
    expect(screen.queryByText("Montant TTC")).not.toBeInTheDocument();
  });
});

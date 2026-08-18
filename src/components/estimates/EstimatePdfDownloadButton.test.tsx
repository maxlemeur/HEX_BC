import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimatePdfDownloadButton } from "@/components/estimates/EstimatePdfDownloadButton";

vi.mock("@/lib/estimates/client", () => ({
  fetchEstimatePdfStatus: vi.fn(),
  requestEstimatePdfGeneration: vi.fn(),
}));

afterEach(cleanup);

describe("EstimatePdfDownloadButton", () => {
  it("announces the preparation step before generation", () => {
    render(<EstimatePdfDownloadButton versionId="version-1" />);

    expect(
      screen.getByRole("button", { name: "Préparer le PDF" }),
    ).toBeInTheDocument();
  });
});

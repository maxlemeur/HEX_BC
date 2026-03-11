import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TakeoffFlowHierarchyPanel } from "@/components/takeoff/TakeoffFlowHierarchyPanel";

describe("TakeoffFlowHierarchyPanel", () => {
  it("highlights the current principal surface and keeps legacy voluntary", () => {
    render(
      <TakeoffFlowHierarchyPanel currentKind="principal" legacyPlanSetCount={1} />
    );

    expect(screen.getByText("Flux principal")).toBeInTheDocument();
    expect(screen.getByText("Aides adjacentes")).toBeInTheDocument();
    expect(screen.getByText("Fallback legacy")).toBeInTheDocument();
    expect(screen.getByText("ici")).toBeInTheDocument();
    expect(screen.getByText("volontaire")).toBeInTheDocument();
    expect(screen.getByText("1 fallback legacy actif")).toBeInTheDocument();
  });
});

import { Children, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import DashboardMappingsPage from "@/app/dashboard/mappings/page";

type StepperElementProps = {
  importId?: string | null;
};

describe("DashboardMappingsPage", () => {
  it("passes import_id from query params to DpgfStepper", async () => {
    const pageElement = (await DashboardMappingsPage({
      searchParams: Promise.resolve({ import_id: "import-123" }),
    })) as ReactElement<{ children: ReactNode }>;

    const children = Children.toArray(pageElement.props.children);
    const stepperElement = children[0] as ReactElement<StepperElementProps>;

    expect(stepperElement.props.importId).toBe("import-123");
  });

  it("uses null when import_id query param is missing", async () => {
    const pageElement = (await DashboardMappingsPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactNode }>;

    const children = Children.toArray(pageElement.props.children);
    const stepperElement = children[0] as ReactElement<StepperElementProps>;

    expect(stepperElement.props.importId ?? null).toBeNull();
  });
});

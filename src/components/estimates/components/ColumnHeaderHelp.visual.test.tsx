import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ColumnHeaderHelp } from "@/components/estimates/components/ColumnHeaderHelp";

describe("ColumnHeaderHelp visual treatment", () => {
  it("renders the help trigger as a plain question mark", () => {
    render(<ColumnHeaderHelp label="K FO" tooltip="Coefficient fourniture" />);

    const trigger = screen.getByRole("button", { name: "Aide : K FO" });

    expect(trigger).toHaveTextContent("?");
    expect(trigger).toHaveClass(
      "!h-4",
      "!w-3",
      "!text-[9px]",
      "border-0",
      "bg-transparent",
      "p-0",
    );
    expect(trigger).not.toHaveClass("rounded-full", "border-blue-300");
  });
});

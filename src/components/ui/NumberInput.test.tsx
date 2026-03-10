import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { NumberInput } from "@/components/ui/NumberInput";

function ControlledNumberInput({
  initialValue,
}: Readonly<{
  initialValue: number;
}>) {
  const [value, setValue] = useState(initialValue);

  return (
    <NumberInput
      aria-label="Nombre"
      value={value}
      onValueChange={setValue}
      step="0.01"
      min={0}
      emptyValue={0}
    />
  );
}

describe("ui/NumberInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps intermediate decimal input while the controlled value updates", async () => {
    const user = userEvent.setup();

    render(<ControlledNumberInput initialValue={1} />);

    const input = screen.getByLabelText("Nombre");
    await user.clear(input);
    await user.type(input, "1.2");

    expect(input).toHaveValue(1.2);
    expect((input as HTMLInputElement).value).toBe("1.2");
  });

  it("restores the empty value on blur after clearing the field", async () => {
    const user = userEvent.setup();

    render(<ControlledNumberInput initialValue={3} />);

    const input = screen.getByLabelText("Nombre");
    await user.clear(input);
    await user.tab();

    expect(input).toHaveValue(0);
    expect((input as HTMLInputElement).value).toBe("0");
  });
});

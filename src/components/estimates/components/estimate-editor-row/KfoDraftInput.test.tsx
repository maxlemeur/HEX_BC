import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KfoDraftInput } from "./KfoDraftInput";

afterEach(cleanup);

// Historical factors are valid individually even when their effective display exceeds a single column.
it.each([[999999999.999, 1.03, "1029999999,99897"], [1.13625, 1.03, "1,170338"], [0.000001, 1, "0,000001"]])(
  "renders the historical effective factor %s × %s without imposing a write limit", (value, provision, expected) => {
    render(<KfoDraftInput isV3 foProvision={provision} value={value} aria-label="K FO historique"
      onValueChange={vi.fn()} onValueCommit={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "K FO historique" })).toHaveValue(expected);
  });
